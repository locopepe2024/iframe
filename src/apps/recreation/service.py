"""Owner-scoped source registration and durable, revision-checked analysis jobs."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import threading
import time
import warnings
from fractions import Fraction
from urllib.parse import urlsplit

from PIL import Image, UnidentifiedImageError
from uuid import uuid4

from fastapi import HTTPException

from ..identity import UserContext
from ..studio_access import studio_owner_dir
from .analysis import MAX_BYTES, analyze, extract_pair, fingerprint
from .mentions import TOKEN, compile_mentions
from .prompt_contract import compile_h3, guidance_snapshot
from ...utils.model_catalog import load_generated_model_catalog
from ...utils.uniart_catalog import fetch_uniart_catalog


_RECOVERY_LOCK = threading.RLock()
_RECOVERY_TASKS: set[str] = set()
_MEDIA_COMMAND_TIMEOUT_SECONDS = 600

# These defaults are part of the recreation contract, rather than a provider
# fallback.  They are kept in one place so the API, persisted tasks, and UI
# can agree on what a newly-created task means.
DEFAULT_RECREATION_VIDEO_MODEL = "uniart/minimax-h3-vip"
DEFAULT_KEYFRAME_IMAGE_MODEL = "uniart/gpt-image-2"
VERIFIED_RECREATION_VIDEO_MODELS = frozenset({DEFAULT_RECREATION_VIDEO_MODEL})


def _static_uniart_models():
    """Return the generated compatibility catalog without contacting UniArt."""
    try:
        catalog = load_generated_model_catalog()
    except (OSError, ValueError, TypeError):
        return []
    models = catalog.get("models", {})
    return [value for value in models.values() if isinstance(value, dict)]


def _model_option(model):
    """Expose only non-secret model metadata to the recreation UI."""
    return {
        key: model[key]
        for key in ("id", "display_name", "description", "family", "capabilities", "duration", "params", "inputs")
        if key in model
    }

class RecreationService:
    def __init__(self, user: UserContext):
        if not user.user_id or not user.owner_profile_id:
            raise ValueError("Authenticated owner required")
        self.user = user
        self.root = (Path(studio_owner_dir(user.owner_profile_id)) / "recreation").resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _live_uniart_models(self):
        """Read the current owner catalog when credentials are available.

        Unit tests and offline local projects may intentionally have no
        runtime credential; those callers use the generated compatibility
        catalog instead. Once a credential is configured, a failed catalog
        read is surfaced as a preflight error so a paid task is not created
        against an unverified route.
        """
        from ..studio_access import runtime_uniart_for_owner

        try:
            config = runtime_uniart_for_owner(self.user.user_id, self.user.owner_profile_id)
        except HTTPException as exc:
            if exc.status_code == 409:
                return None
            raise
        except sqlite3.OperationalError as exc:
            # A fresh/offline test or desktop profile can have an empty legacy
            # config database before the user-config schema is initialized.
            # Treat that state like "no credential"; other DB failures remain
            # visible instead of silently widening the model gate.
            if "no such table: user_configs" in str(exc):
                return None
            raise HTTPException(503, "UniArt model catalog configuration is unavailable") from exc
        try:
            return fetch_uniart_catalog(config)
        except Exception as exc:
            raise HTTPException(503, "UniArt model catalog is unavailable; retry preflight before generating") from exc

    def _model_for_capability(self, model, capability, label):
        model_id = str(model or "").strip()
        if not model_id or not model_id.startswith("uniart/"):
            raise HTTPException(422, f"{label} model is required")
        live_models = self._live_uniart_models()
        candidates = live_models if live_models is not None else _static_uniart_models()
        selected = next((item for item in candidates if item.get("id") == model_id), None)
        if not selected or capability not in (selected.get("capabilities") or []):
            raise HTTPException(422, f"Selected {label} model is unavailable for {capability} in the current UniArt catalog")
        return model_id

    def _recreation_video_model(self, model):
        model_id = str(model or "").strip()
        # The prompt compiler currently proves only the MiniMax H3 native
        # contract. Capability metadata alone is not evidence that another
        # video family consumes the same labels or source-video mapping.
        if model_id not in VERIFIED_RECREATION_VIDEO_MODELS:
            raise HTTPException(422, "Native recreation prompt contract is not verified for this model")
        self._model_for_capability(model_id, "r2v", "video")
        return model_id

    def model_options(self):
        """Return safe, recreation-eligible model options for the UI."""
        source = "static"
        try:
            models = self._live_uniart_models()
            if models is not None:
                source = "live"
        except HTTPException:
            # A picker should remain usable when the account catalog is
            # temporarily unavailable; paid plan/submit still fail closed via
            # ``_live_uniart_models``.
            models = None
        candidates = models if models is not None else _static_uniart_models()
        image_models = [
            _model_option(item) for item in candidates
            if str(item.get("id") or "").startswith("uniart/")
            and "i2i" in (item.get("capabilities") or [])
        ]
        video_models = [
            _model_option(item) for item in candidates
            if item.get("id") in VERIFIED_RECREATION_VIDEO_MODELS
            and "r2v" in (item.get("capabilities") or [])
        ]
        image_default = (
            DEFAULT_KEYFRAME_IMAGE_MODEL
            if any(item["id"] == DEFAULT_KEYFRAME_IMAGE_MODEL for item in image_models)
            else image_models[0]["id"] if image_models else DEFAULT_KEYFRAME_IMAGE_MODEL
        )
        video_default = (
            DEFAULT_RECREATION_VIDEO_MODEL
            if any(item["id"] == DEFAULT_RECREATION_VIDEO_MODEL for item in video_models)
            else video_models[0]["id"] if video_models else DEFAULT_RECREATION_VIDEO_MODEL
        )
        return {
            "provider": "uniart",
            "source": source,
            "defaults": {
                "image_model": image_default,
                "video_model": video_default,
            },
            "image_models": image_models,
            "video_models": video_models,
        }

    @contextmanager
    def db(self):
        connection = sqlite3.connect("output/recreation.sqlite3", timeout=10)
        try:
            connection.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS media_records (media_id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, display_name TEXT NOT NULL, storage_path TEXT NOT NULL, sha256 TEXT NOT NULL, metadata TEXT NOT NULL, created_at REAL NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS keyframe_tasks (task_id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS recreation_generation_tasks (task_id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, generation_id TEXT NOT NULL, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS recreation_assembly_tasks (task_id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT NOT NULL, generation_id TEXT NOT NULL, data TEXT NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS media_owner_project ON media_records(owner, project_id, created_at, media_id)")
            connection.execute("CREATE INDEX IF NOT EXISTS keyframe_owner_project ON keyframe_tasks(owner, project_id)")
            connection.execute("CREATE INDEX IF NOT EXISTS generation_owner_project ON recreation_generation_tasks(owner, project_id, generation_id)")
            connection.execute("CREATE INDEX IF NOT EXISTS assembly_owner_project ON recreation_assembly_tasks(owner, project_id, generation_id)")
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _get(self, db, project_id):
        row = db.execute("SELECT data FROM projects WHERE id=? AND owner=?",
                         (project_id, self.user.owner_profile_id)).fetchone()
        if not row:
            raise HTTPException(404, "Recreation project not found")
        return json.loads(row[0])

    def _save(self, db, record):
        record["revision"] += 1
        record["updated_at"] = time.time()
        db.execute("UPDATE projects SET data=? WHERE id=? AND owner=?",
                   (json.dumps(record), record["id"], self.user.owner_profile_id))

    def _path(self, stored):
        path = (Path("output") / stored).resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise ValueError("Source is missing or outside the project owner")
        return path

    def _verified_source_path(self, record):
        """Return the registered source or expose a retryable stale-state error.

        Generation planning runs before a paid submission transaction.  A
        missing or changed source must therefore be represented as a conflict
        rather than escaping as an unhandled ``ValueError`` (which would turn
        the submit endpoint into a 500 and obscure the recovery action).
        """
        try:
            source = self._path(record["source_url"])
            digest = fingerprint(source)
        except ValueError as exc:
            raise HTTPException(409, "Source is missing or changed; register the source again") from exc
        if digest != record["source_fingerprint"]:
            raise HTTPException(409, "Source is missing or changed; register the source again")
        return source

    def _verified_source_media(self, db, record):
        """Return the immutable source media row and its verified local path.

        ``source_url`` predates the media index and is retained for project
        compatibility.  Ref2V submission uses the indexed media ID as the
        durable identity, while both records and the bytes on disk must still
        agree before a paid task is planned or submitted.
        """
        source_path = self._verified_source_path(record)
        try:
            source = self._media(db, record["source_media_id"])
            indexed_path = self._path(source["storage_path"])
            indexed_digest = fingerprint(indexed_path)
        except (KeyError, ValueError, HTTPException) as exc:
            raise HTTPException(409, "Source is missing or changed; register the source again") from exc
        if (
            source["kind"] != "source_video"
            or source["storage_path"] != record.get("source_url")
            or source["sha256"] != record.get("source_fingerprint")
            or indexed_digest != record.get("source_fingerprint")
        ):
            raise HTTPException(409, "Source is missing or changed; register the source again")
        return source, source_path

    def _provider_media_ref(self, item):
        """Resolve an indexed local media item to a provider-readable ref.

        With COS/OSS configured the UniArt adapter uploads local paths and
        signs them.  Deployments that intentionally keep media on the iFrame
        disk may set ``UNIART_MEDIA_BASE_URL`` to the externally reachable
        backend origin; in that mode we issue a short-lived owner-signed
        ``/studio/media`` URL.  A bare local path remains an internal worker
        reference and is never treated as a provider URL by the adapter.
        """
        path = self._path(item["storage_path"])
        base = os.getenv("UNIART_MEDIA_BASE_URL", "").strip()
        if not base:
            return str(path)
        parsed = urlsplit(base)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("UNIART_MEDIA_BASE_URL must be an HTTP(S) origin without credentials")
        from ..studio_access import studio_media_url
        try:
            signed = studio_media_url(self.user.owner_profile_id, item["storage_path"], ttl_seconds=1800)
        except HTTPException as exc:
            raise ValueError("Local disk media requires LUMENX_MEDIA_SIGNING_KEY") from exc
        if not signed.startswith("/studio/media/"):
            raise ValueError("Local disk media could not be converted to a signed URL")
        return base.rstrip("/") + signed

    def register(self, stream, filename: str):
        suffix = Path(filename).suffix.lower()
        if suffix not in (".mp4", ".mov", ".webm", ".mkv"):
            raise HTTPException(422, "Supported sources: MP4, MOV, WebM, MKV")
        project_id = uuid4().hex
        folder = self.root / project_id
        folder.mkdir()
        source = folder / ("source" + suffix)
        try:
            size = 0
            with source.open("xb") as target:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, "Source exceeds 256 MiB")
                    target.write(chunk)
            digest = fingerprint(source)
            media_id = uuid4().hex
            record = {"id": project_id, "title": Path(filename).name[:200], "source_media_id": media_id,
                      "owner_user_id": self.user.user_id, "owner_profile_id": self.user.owner_profile_id,
                      "source_asset_id": uuid4().hex,
                      "source_url": source.relative_to(Path("output").resolve()).as_posix(),
                      "source_fingerprint": digest, "status": "registered", "revision": 0,
                      "created_at": time.time(), "updated_at": time.time(), "analysis": None,
                      "analysis_id": None, "timeline": None, "error": None, "attempt": 0}
            with self.db() as db:
                db.execute("INSERT INTO projects VALUES (?, ?, ?)",
                           (project_id, self.user.owner_profile_id, json.dumps(record)))
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (media_id, self.user.owner_profile_id, project_id, "source_video", record["title"], record["source_url"], digest, json.dumps({"mime": "video"}), time.time()))
            return record
        except BaseException:
            shutil.rmtree(folder)
            raise

    def get(self, project_id):
        with self.db() as db:
            # A disconnected browser must not change the lifecycle of a
            # running analysis.  The worker or an explicit owner cancellation
            # is responsible for reaching a terminal state.
            return self._get(db, project_id)

    def cancel_analysis(self, project_id, revision, analysis_id):
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record.get("analysis_id") != analysis_id:
                raise HTTPException(409, "Analysis changed; refresh before cancelling")
            if record["status"] not in ("queued", "analyzing"):
                raise HTTPException(409, "Analysis is no longer active")
            record.update(status="cancelled", error="Analysis cancelled by user")
            self._save(db, record)
            return record

    def list(self):
        with self.db() as db:
            ids = [row[0] for row in db.execute("SELECT id FROM projects WHERE owner=?", (self.user.owner_profile_id,))]
        return sorted([self.get(i) for i in ids], key=lambda p: p["created_at"], reverse=True)

    def search_media(self, *, query="", kind=None, project_id=None, limit=50, cursor=0):
        limit = max(1, min(int(limit), 100))
        query = query.strip().lower()
        conditions, params = ["owner=?"], [self.user.owner_profile_id]
        for column, value in [("kind", kind), ("project_id", project_id)]:
            if value:
                conditions.append(f"{column}=?")
                params.append(value)
        if query:
            conditions.append("instr(lower(display_name), ?) > 0")
            params.append(query)
        with self.db() as db:
            rows = db.execute("SELECT media_id, project_id, kind, display_name, storage_path, sha256, metadata, created_at FROM media_records WHERE " + " AND ".join(conditions) + " ORDER BY created_at DESC, media_id DESC LIMIT ? OFFSET ?", (*params, limit + 1, cursor)).fetchall()
        items = []
        for row in rows[:limit]:
            items.append({"media_id": row[0], "project_id": row[1], "kind": row[2], "display_name": row[3], "storage_path": row[4], "sha256": row[5], "metadata": json.loads(row[6]), "created_at": row[7]})
        return {"items": items, "next_cursor": cursor + limit if len(rows) > limit else None}

    def _index_analysis(self, db, record):
        data = record["analysis"]
        files = {}
        for sample in data.get("samples", []):
            files[sample["url"]] = ("sample_frame", sample["pts"], "sample")
        for pair in [*data["candidates"], *data.get("manual_evidence", {}).values()]:
            files[pair["before_url"]] = ("evidence_frame", pair["before_pts"], "before")
            files[pair["after_url"]] = ("evidence_frame", pair["pts"], "after")
        files[data["contact_sheet_url"]] = ("contact_sheet", None, "contact_sheet")
        for path, (kind, pts, role) in files.items():
            metadata = {"parent_media_id": record["source_media_id"], "analysis_id": record["analysis_id"],
                        "pts": pts, "time_base": data["time_base"], "role": role}
            digest = fingerprint(self._path(path))
            existing = db.execute("SELECT media_id FROM media_records WHERE owner=? AND project_id=? AND storage_path=?",
                                  (self.user.owner_profile_id, record["id"], path)).fetchone()
            if existing:
                db.execute("UPDATE media_records SET kind=?, sha256=?, metadata=? WHERE media_id=? AND owner=?",
                           (kind, digest, json.dumps(metadata), existing[0], self.user.owner_profile_id))
            else:
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (uuid4().hex, self.user.owner_profile_id, record["id"], kind,
                            f'{record["title"]} · {role} · {pts if pts is not None else ""}',
                            path, digest, json.dumps(metadata), time.time()))

    def _media(self, db, media_id):
        row = db.execute("SELECT media_id, project_id, kind, display_name, storage_path, sha256, metadata, created_at FROM media_records WHERE media_id=? AND owner=?",
                         (media_id, self.user.owner_profile_id)).fetchone()
        if not row:
            raise HTTPException(404, "Media not found")
        return dict(zip(("media_id", "project_id", "kind", "display_name", "storage_path", "sha256", "metadata", "created_at"),
                        (*row[:6], json.loads(row[6]), row[7])))

    def media(self, media_id):
        with self.db() as db:
            return self._media(db, media_id)

    def _image(self, db, media_id):
        item = self._media(db, media_id)
        if item["kind"] not in ("sample_frame", "evidence_frame", "contact_sheet", "reference_image", "replacement_image"):
            raise HTTPException(422, "An image media record is required")
        if fingerprint(self._path(item["storage_path"])) != item["sha256"]:
            raise HTTPException(409, "Media fingerprint changed")
        return item

    def upload_image(self, project_id, stream, filename, kind, parent_media_id=None):
        if kind not in ("reference_image", "replacement_image"):
            raise HTTPException(422, "Invalid image role")
        with self.db() as db:
            self._get(db, project_id)
            if parent_media_id:
                self._image(db, parent_media_id)
        media_id = uuid4().hex
        folder = self.root / project_id / "images" / media_id
        folder.mkdir(parents=True)
        temporary = folder / "upload"
        try:
            size = 0
            with temporary.open("xb") as target:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > 25 * 1024 * 1024:
                        raise HTTPException(413, "Image exceeds 25 MiB")
                    target.write(chunk)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(temporary) as image:
                        fmt, width, height = image.format, image.width, image.height
                        if fmt not in ("PNG", "JPEG", "WEBP") or width * height > 25000000 or getattr(image, "n_frames", 1) != 1:
                            raise ValueError("Expected a still PNG, JPEG or WebP up to 25 megapixels")
                        image.verify()
                    with Image.open(temporary) as image:
                        image.load()
            except (OSError, UnidentifiedImageError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
                raise HTTPException(422, "Invalid image: use a still PNG, JPEG or WebP up to 25 megapixels") from exc
            path = temporary.with_name("image." + {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[fmt])
            temporary.rename(path)
            metadata = {"width": width, "height": height, "bytes": size, "mime": Image.MIME[fmt]}
            if parent_media_id:
                metadata["parent_media_id"] = parent_media_id
            item = {"media_id": media_id, "project_id": project_id, "kind": kind,
                    "display_name": Path(filename).name[:200], "storage_path": path.relative_to(Path("output").resolve()).as_posix(),
                    "sha256": fingerprint(path), "metadata": metadata, "created_at": time.time()}
            with self.db() as db:
                self._get(db, project_id)
                if parent_media_id:
                    self._image(db, parent_media_id)
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (media_id, self.user.owner_profile_id, project_id, kind, item["display_name"], item["storage_path"], item["sha256"], json.dumps(metadata), item["created_at"]))
            return item
        except BaseException:
            shutil.rmtree(folder)
            raise

    @staticmethod
    def _keyframe_prompt(instruction):
        return (
            "Use case: precise-object-edit. Image 1 is the edit target from the source video. "
            "Image 2 is the replacement product identity reference. The additional constraint below "
            "identifies the exact existing object in Image 1 to replace. Replace only that object with "
            "the complete product package shown in Image 2. If the target object is not unambiguous, "
            "do not alter unrelated content. "
            "Preserve every person, face, hand, body pose, action, background object, composition, "
            "crop, camera angle, depth of field and lighting from Image 1. Match the new package's "
            "perspective, scale, position, environmental light, contact shadow and hand occlusion. "
            "Preserve the package design, colors, logo and printed appearance from Image 2; do not "
            "invent, translate or redesign packaging text. Do not add objects, remove objects, change "
            "the scene or alter the people. Produce one photorealistic corrected video keyframe. "
            f"Additional constraint: {instruction.strip()}"
        )

    def _task(self, db, task_id):
        row = db.execute("SELECT data FROM keyframe_tasks WHERE task_id=? AND owner=?",
                         (task_id, self.user.owner_profile_id)).fetchone()
        if not row:
            raise HTTPException(404, "Keyframe task not found")
        return json.loads(row[0])

    def _public_task(self, db, task):
        result = {key: value for key, value in task.items() if key != "prompt"}
        result["output_media"] = self._media(db, task["output_media_id"]) if task.get("output_media_id") else None
        return result

    def create_keyframe_task(self, project_id, shot_id, revision, analysis_id, reference_media_id,
                             replacement_media_id, instruction, accept_cost,
                             model=DEFAULT_KEYFRAME_IMAGE_MODEL):
        if not accept_cost:
            raise HTTPException(422, "Paid image generation requires explicit cost acceptance")
        if len(instruction) > 2000:
            raise HTTPException(422, "Keyframe instruction exceeds 2000 characters")
        if not TOKEN.sub("", instruction).strip():
            raise HTTPException(422, "Describe the exact object to replace before generating a corrected keyframe")
        selected_model = self._model_for_capability(model, "i2i", "image")
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["analysis_id"] != analysis_id or record["status"] != "confirmed" or not record.get("timeline"):
                raise HTTPException(409, "Timeline changed; refresh before generating a corrected keyframe")
            if not any(shot["id"] == shot_id for shot in record["timeline"]["shots"]):
                raise HTTPException(404, "Shot not found")
            reference = self._image(db, reference_media_id)
            replacement = self._image(db, replacement_media_id)
            if reference["kind"] not in ("sample_frame", "evidence_frame", "reference_image"):
                raise HTTPException(422, "Keyframe edit target must be a source frame or corrected reference")
            if reference["project_id"] != project_id and reference["kind"] != "reference_image":
                raise HTTPException(422, "Source frame belongs to another recreation project")
            if replacement["kind"] != "replacement_image":
                raise HTTPException(422, "Replacement product must use the replacement image role")
            compiled_instruction, bad_instruction = compile_mentions(instruction, [
                {"media_id": reference_media_id, "label": "Image 1"},
                {"media_id": replacement_media_id, "label": "Image 2"},
            ])
            if bad_instruction:
                raise HTTPException(422, "Keyframe instruction contains an unresolved material reference")
            active_rows = db.execute(
                "SELECT task_id, data FROM keyframe_tasks WHERE owner=? AND project_id=? "
                "AND json_extract(data, '$.shot_id')=? AND json_extract(data, '$.revision')=? "
                "AND json_extract(data, '$.status') IN ('pending','processing')",
                (self.user.owner_profile_id, project_id, shot_id, revision),
            ).fetchall()
            active = bool(active_rows)
            if active:
                raise HTTPException(409, "A corrected keyframe task is already active for this shot")
            prompt = self._keyframe_prompt(compiled_instruction)
            now = time.time()
            task = {
                "task_id": uuid4().hex, "project_id": project_id, "shot_id": shot_id,
                "revision": revision, "analysis_id": analysis_id, "status": "pending",
                "model": selected_model, "reference_media_id": reference_media_id,
                "replacement_media_id": replacement_media_id, "reference_sha256": reference["sha256"],
                "replacement_sha256": replacement["sha256"], "prompt": prompt,
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "output_media_id": None, "error": None, "created_at": now, "updated_at": now,
            }
            db.execute("INSERT INTO keyframe_tasks VALUES (?, ?, ?, ?)",
                       (task["task_id"], self.user.owner_profile_id, project_id, json.dumps(task)))
            return self._public_task(db, task)

    def keyframe_task(self, task_id):
        with self.db() as db:
            task = self._task(db, task_id)
            return self._public_task(db, task)

    def keyframe_tasks(self, project_id, shot_id=None):
        with self.db() as db:
            self._get(db, project_id)
            conditions = ["owner=?", "project_id=?"]
            params = [self.user.owner_profile_id, project_id]
            if shot_id:
                conditions.append("json_extract(data, '$.shot_id')=?")
                params.append(shot_id)
            rows = db.execute(
                "SELECT data FROM keyframe_tasks WHERE " + " AND ".join(conditions) +
                " ORDER BY json_extract(data, '$.created_at') DESC, task_id DESC",
                params,
            ).fetchall()
            return [self._public_task(db, json.loads(row[0])) for row in rows]

    def cancel_keyframe_task(self, task_id):
        with self.db() as db:
            task = self._task(db, task_id)
            if task["status"] not in ("pending", "processing"):
                raise HTTPException(409, "Keyframe task is no longer active")
            task.update(status="cancelled", error="Keyframe generation cancelled by user", updated_at=time.time())
            db.execute("UPDATE keyframe_tasks SET data=? WHERE task_id=? AND owner=?",
                       (json.dumps(task), task_id, self.user.owner_profile_id))
            return self._public_task(db, task)

    def process_keyframe_task(self, task_id, provider_config=None):
        folder = None
        try:
            with self.db() as db:
                task = self._task(db, task_id)
                if task["status"] != "pending":
                    return
                task.update(status="processing", updated_at=time.time())
                db.execute("UPDATE keyframe_tasks SET data=? WHERE task_id=? AND owner=?",
                           (json.dumps(task), task_id, self.user.owner_profile_id))
                reference = self._image(db, task["reference_media_id"])
                replacement = self._image(db, task["replacement_media_id"])
                if reference["sha256"] != task["reference_sha256"] or replacement["sha256"] != task["replacement_sha256"]:
                    raise ValueError("Keyframe input fingerprint changed")
                reference_path = self._path(reference["storage_path"])
                replacement_path = self._path(replacement["storage_path"])
                width = int(reference["metadata"].get("width") or 16)
                height = int(reference["metadata"].get("height") or 9)
            from ...models.uniart import UniArtImageModel
            from ..studio_access import runtime_uniart_for_owner
            config = provider_config if provider_config is not None else runtime_uniart_for_owner(
                self.user.user_id, self.user.owner_profile_id)
            media_id = uuid4().hex
            folder = self.root / task["project_id"] / "images" / media_id
            folder.mkdir(parents=True)
            output = folder / "image.png"
            ratios = ((1, 1, "1:1"), (4, 3, "4:3"), (3, 4, "3:4"), (16, 9, "16:9"), (9, 16, "9:16"))
            ratio = min(ratios, key=lambda item: abs(width / height - item[0] / item[1]))[2]
            UniArtImageModel(config).generate(
                task["prompt"], str(output), model_name=task["model"], size="2k", quality="high",
                aspect_ratio=ratio, ref_image_paths=[str(reference_path), str(replacement_path)],
            )
            with Image.open(output) as image:
                output_format = image.format
                image.verify()
            extension = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}.get(output_format)
            if not extension:
                raise ValueError("Generated keyframe must be PNG, JPEG or WebP")
            corrected_output = output.with_name(f"image.{extension}")
            if corrected_output != output:
                output.rename(corrected_output)
                output = corrected_output
            with Image.open(output) as image:
                image.load()
                out_width, out_height = image.width, image.height
            item = {
                "media_id": media_id, "project_id": task["project_id"], "kind": "reference_image",
                "display_name": f"Corrected keyframe · {task['shot_id'][:8]}",
                "storage_path": output.relative_to(Path("output").resolve()).as_posix(),
                "sha256": fingerprint(output),
                "metadata": {"width": out_width, "height": out_height, "bytes": output.stat().st_size,
                             "mime": Image.MIME[output_format], "parent_media_id": task["reference_media_id"],
                             "replacement_media_id": task["replacement_media_id"], "keyframe_task_id": task_id,
                             "model": task["model"], "prompt_sha256": task["prompt_sha256"]},
                "created_at": time.time(),
            }
            with self.db() as db:
                current = self._task(db, task_id)
                if current["status"] != "processing":
                    raise ValueError("Keyframe task state changed")
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (media_id, self.user.owner_profile_id, task["project_id"], item["kind"],
                            item["display_name"], item["storage_path"], item["sha256"],
                            json.dumps(item["metadata"]), item["created_at"]))
                current.update(status="completed", output_media_id=media_id, error=None, updated_at=time.time())
                db.execute("UPDATE keyframe_tasks SET data=? WHERE task_id=? AND owner=?",
                           (json.dumps(current), task_id, self.user.owner_profile_id))
        except Exception as exc:
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
            with self.db() as db:
                try:
                    task = self._task(db, task_id)
                except HTTPException:
                    return
                if task["status"] not in ("completed", "cancelled"):
                    task.update(status="failed", error=str(exc)[:1000], updated_at=time.time())
                    db.execute("UPDATE keyframe_tasks SET data=? WHERE task_id=? AND owner=?",
                               (json.dumps(task), task_id, self.user.owner_profile_id))

    def bind_shot(self, project_id, shot_id, revision, analysis_id, reference_media_id, replacement_media_id, instruction, description=None, instruction_refs=None):
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["analysis_id"] != analysis_id or record["status"] != "confirmed" or not record["timeline"]:
                raise HTTPException(409, "Timeline changed; refresh before assigning references")
            shot = next((s for s in record["timeline"]["shots"] if s["id"] == shot_id), None)
            if not shot:
                raise HTTPException(404, "Shot not found")
            for media_id in (reference_media_id, replacement_media_id):
                if media_id:
                    self._image(db, media_id)
            if len(instruction) > 4000:
                raise HTTPException(422, "Instruction exceeds 4000 characters")
            shot.update(reference_media_id=reference_media_id, replacement_media_id=replacement_media_id, instruction=instruction)
            if description is not None:
                if len(description) > 6000:
                    raise HTTPException(422, "Description exceeds 6000 characters")
                shot["description"] = description
            refs = instruction_refs or []
            allowed = {reference_media_id, replacement_media_id} - {None}
            if any(not isinstance(ref, dict) or not ref.get("media_id") or not str(ref.get("token", "")).startswith("@{") or ref["media_id"] not in allowed for ref in refs):
                raise HTTPException(422, "Invalid material reference")
            shot["instruction_refs"] = refs
            self._save(db, record)
        return record

    def generation_plan(self, project_id, revision, model=DEFAULT_RECREATION_VIDEO_MODEL, audio_policy="silent", soundscape="", generation_durations=None):
        model = self._recreation_video_model(model)
        if audio_policy not in ("silent", "generated", "preserve_source"):
            raise HTTPException(422, "Unsupported audio policy")
        if audio_policy == "generated" and not soundscape.strip():
            raise HTTPException(422, "Generated audio requires explicit sound requirements")
        guidance = guidance_snapshot()
        generation_durations = generation_durations or {}
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["status"] != "confirmed" or not record.get("timeline"):
                raise HTTPException(409, "Confirm the current timeline before preparing a plan")
            source_media, _source_path = self._verified_source_media(db, record)
            shots, blockers = [], []
            for index, shot in enumerate(record["timeline"]["shots"], 1):
                description = shot.get("description", "").strip()
                instruction = shot.get("instruction", "").strip()
                missing = []
                generation_duration = generation_durations.get(shot["id"])
                if type(generation_duration) is not int or not 4 <= generation_duration <= 15:
                    missing.append("generation_duration_required")
                if audio_policy == "preserve_source" and not record["analysis"].get("audio_streams"):
                    missing.append("source_audio_unavailable")
                if not description:
                    missing.append("description_required")
                if not shot.get("reference_media_id"):
                    missing.append("reference_required")
                if shot.get("replacement_media_id") and not instruction:
                    missing.append("replacement_instruction_required")
                images = []
                for role in ("reference", "replacement"):
                    media_id = shot.get(role + "_media_id")
                    if media_id:
                        item = self._image(db, media_id)
                        images.append({"media_id": media_id, "sha256": item["sha256"], "role": role,
                                       "label": f"<Picture {len(images) + 1}>"})
                description, bad_description = compile_mentions(description, images)
                instruction, bad_instruction = compile_mentions(instruction, images)
                if bad_description or bad_instruction:
                    missing.append("media_labels_reserved")
                duration = (shot["end_pts"] - shot["start_pts"]) * Fraction(record["analysis"]["time_base"])
                if type(generation_duration) is int and generation_duration < duration:
                    missing.append("generation_duration_too_short")
                prompt = None
                if not missing:
                    prompt, errors = compile_h3(
                        description,
                        instruction,
                        replacement=bool(shot.get("replacement_media_id")),
                        duration=generation_duration,
                        audio_policy=audio_policy,
                        soundscape=soundscape,
                        source_video=True,
                    )
                    if errors:
                        missing.append("native_prompt_invalid")
                        prompt = None
                if missing:
                    blockers.append({"shot_id": shot["id"], "shot_number": index, "reasons": missing})
                shots.append({"shot_id": shot["id"], "shot_number": index, "start_pts": shot["start_pts"],
                              "end_pts": shot["end_pts"], "target_duration": str(duration), "generation_duration": generation_duration,
                              "generate_audio": audio_policy == "generated", "images": images, "prompt": prompt})
            return {"project_id": project_id, "revision": revision, "analysis_id": record["analysis_id"],
                    "model": model, "model_family": "minimax_h3", "mapping_strategy": "h3_picture_video_labels", "guidance": guidance,
                    "source_video": {"media_id": source_media["media_id"], "sha256": source_media["sha256"], "label": "<Video 1>"},
                    "time_base": record["analysis"]["time_base"], "audio_policy": audio_policy, "ready": not blockers,
                    "submission_enabled": True,
                    "blockers": blockers, "shots": shots}

    def _generation_task(self, db, task_id):
        row = db.execute(
            "SELECT data FROM recreation_generation_tasks WHERE task_id=? AND owner=?",
            (task_id, self.user.owner_profile_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Recreation generation task not found")
        return json.loads(row[0])

    def _public_generation_task(self, db, task):
        result = {key: value for key, value in task.items() if key not in {"local_output_path"}}
        result["output_media"] = self._media(db, task["output_media_id"]) if task.get("output_media_id") else None
        return result

    def submit_generation(self, project_id, revision, model="uniart/minimax-h3-vip", audio_policy="silent",
                          soundscape="", generation_durations=None, accept_cost=False, seed=None):
        if not accept_cost:
            raise HTTPException(422, "Paid video generation requires explicit cost acceptance")
        plan = self.generation_plan(project_id, revision, model, audio_policy, soundscape, generation_durations)
        if not plan["ready"]:
            reasons = "; ".join(
                f"shot {item['shot_number']}: {','.join(item['reasons'])}"
                for item in plan["blockers"]
            )
            raise HTTPException(422, f"Generation plan is not ready: {reasons}")
        generation_id = uuid4().hex
        now = time.time()
        with self.db() as db:
            record = self._get(db, project_id)
            # The plan is compiled in a separate read transaction. Recheck
            # every revision-bearing fact after acquiring the submission
            # transaction so a timeline edit cannot create a stale paid task.
            if (record["revision"] != revision or record["status"] != "confirmed" or
                    not record.get("timeline") or record.get("analysis_id") != plan["analysis_id"]):
                raise HTTPException(409, "Timeline changed; refresh before submitting generation")
            source_media, _source_path = self._verified_source_media(db, record)
            active = db.execute(
                "SELECT COUNT(*) FROM recreation_generation_tasks WHERE owner=? AND project_id=? "
                "AND json_extract(data, '$.status') IN ('pending','processing')",
                (self.user.owner_profile_id, project_id),
            ).fetchone()[0]
            if active:
                raise HTTPException(409, "A recreation video generation is already active for this project")
            tasks = []
            for shot in plan["shots"]:
                task_id = uuid4().hex
                inputs = []
                for image in shot["images"]:
                    item = self._image(db, image["media_id"])
                    inputs.append({"media_id": item["media_id"], "role": image["label"], "sha256": item["sha256"]})
                task = {
                    "task_id": task_id, "generation_id": generation_id, "project_id": project_id,
                    "shot_id": shot["shot_id"], "shot_number": shot["shot_number"],
                    "revision": revision, "analysis_id": plan["analysis_id"], "status": "pending",
                    "model": model, "prompt": shot["prompt"], "duration": shot["generation_duration"],
                    "audio_policy": audio_policy, "generate_audio": shot["generate_audio"],
                    "soundscape": soundscape, "seed": seed, "inputs": inputs,
                    "source_media_id": source_media["media_id"],
                    "source_fingerprint": source_media["sha256"],
                    "provider_task_id": None, "output_media_id": None, "error": None,
                    "created_at": now, "updated_at": now,
                }
                db.execute("INSERT INTO recreation_generation_tasks VALUES (?, ?, ?, ?, ?)",
                           (task_id, self.user.owner_profile_id, project_id, generation_id, json.dumps(task)))
                tasks.append(self._public_generation_task(db, task))
            return {"generation_id": generation_id, "project_id": project_id, "revision": revision,
                    "analysis_id": plan["analysis_id"], "model": model, "audio_policy": audio_policy,
                    "tasks": tasks}

    def generation_tasks(self, project_id, generation_id=None):
        with self.db() as db:
            self._get(db, project_id)
            conditions = ["owner=?", "project_id=?"]
            params = [self.user.owner_profile_id, project_id]
            if generation_id:
                conditions.append("generation_id=?")
                params.append(generation_id)
            rows = db.execute(
                "SELECT data FROM recreation_generation_tasks WHERE " + " AND ".join(conditions) +
                " ORDER BY json_extract(data, '$.shot_number'), json_extract(data, '$.created_at')",
                params,
            ).fetchall()
            return [self._public_generation_task(db, json.loads(row[0])) for row in rows]

    def generation_task(self, task_id):
        with self.db() as db:
            return self._public_generation_task(db, self._generation_task(db, task_id))

    def recover_generation_tasks(self):
        """Resume only provider tasks whose upstream ID was durably saved.

        A task that was interrupted before the provider ID was persisted is
        intentionally left for an explicit retry; silently resubmitting could
        create a second paid upstream request.
        """
        with self.db() as db:
            rows = db.execute(
                "SELECT task_id, data FROM recreation_generation_tasks WHERE owner=? "
                "AND json_extract(data, '$.status')='processing' "
                "AND json_extract(data, '$.provider_task_id') IS NOT NULL",
                (self.user.owner_profile_id,),
            ).fetchall()
        for task_id, _payload in rows:
            with _RECOVERY_LOCK:
                if task_id in _RECOVERY_TASKS:
                    continue
                _RECOVERY_TASKS.add(task_id)
            thread = threading.Thread(target=self._recover_one, args=(task_id,), daemon=True)
            thread.start()

    def _recover_one(self, task_id):
        try:
            self.process_generation_task(task_id)
        finally:
            with _RECOVERY_LOCK:
                _RECOVERY_TASKS.discard(task_id)

    def cancel_generation_task(self, task_id):
        with self.db() as db:
            task = self._generation_task(db, task_id)
            if task["status"] not in ("pending", "processing"):
                raise HTTPException(409, "Recreation generation task is no longer active")
            task.update(status="cancelled", error="Video generation cancelled by user", updated_at=time.time())
            db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                       (json.dumps(task), task_id, self.user.owner_profile_id))
            return self._public_generation_task(db, task)

    def retry_generation_task(self, task_id, accept_cost=False):
        if not accept_cost:
            raise HTTPException(422, "Retrying video generation requires explicit cost acceptance")
        with self.db() as db:
            task = self._generation_task(db, task_id)
            if task["status"] != "failed":
                raise HTTPException(409, "Only a failed recreation generation task can be retried")
            task.update(status="pending", provider_task_id=None, output_media_id=None, error=None, updated_at=time.time())
            db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                       (json.dumps(task), task_id, self.user.owner_profile_id))
            return self._public_generation_task(db, task)

    def process_generation_task(self, task_id, provider_config=None):
        folder = None
        try:
            with self.db() as db:
                task = self._generation_task(db, task_id)
                if task["status"] not in ("pending", "processing"):
                    return
                if task["status"] == "processing" and not task.get("provider_task_id"):
                    task.update(status="failed", error="Worker interrupted before upstream task ID was saved; retry manually", updated_at=time.time())
                    db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                               (json.dumps(task), task_id, self.user.owner_profile_id))
                    return
                if task["status"] == "pending":
                    task.update(status="processing", updated_at=time.time())
                    db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                               (json.dumps(task), task_id, self.user.owner_profile_id))
                inputs = []
                source = None
                if not task.get("provider_task_id"):
                    for input_ref in task["inputs"]:
                        item = self._image(db, input_ref["media_id"])
                        if item["sha256"] != input_ref["sha256"]:
                            raise ValueError("Generation input fingerprint changed")
                        inputs.append(item)
                    source = self._media(db, task.get("source_media_id"))
                    if source["kind"] != "source_video" or source["sha256"] != task.get("source_fingerprint"):
                        raise ValueError("Generation source fingerprint changed")
                    source_path = self._path(source["storage_path"])
                    if fingerprint(source_path) != task.get("source_fingerprint"):
                        raise ValueError("Generation source fingerprint changed")
            from ...models.uniart import UniArtVideoModel
            from ..studio_access import runtime_uniart_for_owner
            config = provider_config if provider_config is not None else runtime_uniart_for_owner(
                self.user.user_id, self.user.owner_profile_id)
            folder = self.root / task["project_id"] / "generations" / task["task_id"]
            folder.mkdir(parents=True, exist_ok=True)
            output = folder / "result.mp4"

            def save_provider_task(provider_task_id):
                with self.db() as db:
                    current = self._generation_task(db, task_id)
                    if current["status"] == "processing":
                        current.update(provider_task_id=provider_task_id, updated_at=time.time())
                        db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                                   (json.dumps(current), task_id, self.user.owner_profile_id))

            kwargs = {
                "model": task["model"], "mode": "reference2video", "duration": task["duration"],
                # UniArt's video contract accepts 480p/720p for this route.
                # 768p is not a valid Seedance/H3 resolution and is rejected
                # by the provider as a metadata conflict.
                "resolution": "720p", "generate_audio": task["generate_audio"],
                "on_task_submitted": save_provider_task,
            }
            if task.get("seed") is not None:
                kwargs["seed"] = task["seed"]
            if task.get("provider_task_id"):
                kwargs["resume_task_id"] = task["provider_task_id"]
            else:
                kwargs["ref_image_urls"] = [self._provider_media_ref(item) for item in inputs]
                kwargs["ref_video_urls"] = [self._provider_media_ref(source)]
            UniArtVideoModel(config).generate(task["prompt"], str(output), **kwargs)
            if not output.is_file():
                raise ValueError("UniArt returned without a video file")
            item = {
                "media_id": uuid4().hex, "project_id": task["project_id"], "kind": "generated_video",
                "display_name": f"Recreation shot {task['shot_number']} · {task['task_id'][:8]}",
                "storage_path": output.relative_to(Path("output").resolve()).as_posix(),
                "sha256": fingerprint(output),
                "metadata": {"generation_id": task["generation_id"], "task_id": task_id,
                             "shot_id": task["shot_id"], "shot_number": task["shot_number"],
                             "model": task["model"], "duration": task["duration"],
                             "generate_audio": task["generate_audio"],
                             "input_media_ids": [ref["media_id"] for ref in task["inputs"]]},
                "created_at": time.time(),
            }
            with self.db() as db:
                current = self._generation_task(db, task_id)
                if current["status"] != "processing":
                    raise ValueError("Generation task was cancelled while the provider was running")
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (item["media_id"], self.user.owner_profile_id, task["project_id"], item["kind"],
                            item["display_name"], item["storage_path"], item["sha256"],
                            json.dumps(item["metadata"]), item["created_at"]))
                current.update(status="completed", output_media_id=item["media_id"], error=None, updated_at=time.time())
                db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                           (json.dumps(current), task_id, self.user.owner_profile_id))
        except Exception as exc:
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
            with self.db() as db:
                try:
                    current = self._generation_task(db, task_id)
                except HTTPException:
                    return
                if current["status"] not in ("completed", "cancelled"):
                    current.update(status="failed", error=str(exc)[:1000], updated_at=time.time())
                    db.execute("UPDATE recreation_generation_tasks SET data=? WHERE task_id=? AND owner=?",
                               (json.dumps(current), task_id, self.user.owner_profile_id))

    def _assembly_task(self, db, task_id):
        row = db.execute(
            "SELECT data FROM recreation_assembly_tasks WHERE task_id=? AND owner=?",
            (task_id, self.user.owner_profile_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Recreation assembly task not found")
        return json.loads(row[0])

    def _public_assembly_task(self, db, task):
        result = {key: value for key, value in task.items() if key != "local_output_path"}
        result["output_media"] = self._media(db, task["output_media_id"]) if task.get("output_media_id") else None
        return result

    @staticmethod
    def _assembly_seconds(start_pts, end_pts, time_base):
        duration = (end_pts - start_pts) * Fraction(time_base)
        if duration <= 0:
            raise ValueError("Timeline contains a non-positive shot duration")
        return duration

    @staticmethod
    def _seconds_arg(value):
        # Nine decimal places are enough for the source PTS contract while
        # avoiding binary-float noise in FFmpeg command arguments.
        return f"{float(value):.9f}"

    @staticmethod
    def _run_media_command(command, timeout=_MEDIA_COMMAND_TIMEOUT_SECONDS):
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise ValueError(f"FFmpeg media command timed out after {timeout} seconds") from exc
        except FileNotFoundError as exc:
            raise ValueError("FFmpeg/FFprobe is unavailable") from exc
        if result.returncode:
            detail = (result.stderr or b"").decode("utf-8", errors="replace").strip()
            raise ValueError(f"FFmpeg media assembly failed: {detail[-1000:] or 'unknown error'}")
        return result.stdout or b""

    @classmethod
    def _probe_assembly_media(cls, path):
        raw = cls._run_media_command([
            "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
            "-of", "json", str(path),
        ])
        try:
            payload = json.loads(raw.decode("utf-8"))
            duration = float(payload["format"]["duration"])
            streams = payload.get("streams") or []
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            raise ValueError("Generated video has incomplete media metadata") from exc
        if duration <= 0:
            raise ValueError("Generated video has no positive duration")
        return {"duration": duration, "audio_streams": sum(s.get("codec_type") == "audio" for s in streams)}

    @staticmethod
    def _concat_list(path, files):
        # Assembly folders use UUID-derived names, nevertheless escape the
        # syntax so this remains safe if a future filename contains a quote.
        lines = []
        for item in files:
            escaped = str(item).replace("'", "'\\''")
            lines.append(f"file '{escaped}'")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _assembly_cancelled(self, task_id):
        with self.db() as db:
            task = self._assembly_task(db, task_id)
            return task["status"] == "cancelled"

    def submit_assembly(self, project_id, revision, generation_id):
        if not generation_id:
            raise HTTPException(422, "A completed generation is required before assembly")
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["status"] != "confirmed" or not record.get("timeline"):
                raise HTTPException(409, "Timeline changed; refresh before assembling")
            if fingerprint(self._path(record["source_url"])) != record["source_fingerprint"]:
                raise HTTPException(409, "Source fingerprint changed; register the source again")
            rows = db.execute(
                "SELECT data FROM recreation_generation_tasks WHERE owner=? AND project_id=? AND generation_id=?",
                (self.user.owner_profile_id, project_id, generation_id),
            ).fetchall()
            if not rows:
                raise HTTPException(404, "Recreation generation not found")
            generation_tasks = [json.loads(row[0]) for row in rows]
            expected = record["timeline"]["shots"]
            by_shot = {task.get("shot_id"): task for task in generation_tasks}
            if len(by_shot) != len(expected) or any(shot["id"] not in by_shot for shot in expected):
                raise HTTPException(409, "Generation does not cover the confirmed timeline")
            if any(task.get("revision") != revision or task.get("analysis_id") != record["analysis_id"] for task in generation_tasks):
                raise HTTPException(409, "Generation belongs to an earlier timeline revision")
            if any(task.get("status") != "completed" or not task.get("output_media_id") for task in generation_tasks):
                raise HTTPException(409, "Every shot generation must complete before assembly")
            policies = {task.get("audio_policy") for task in generation_tasks}
            if len(policies) != 1 or next(iter(policies)) not in ("silent", "generated", "preserve_source"):
                raise HTTPException(422, "Generation tasks have inconsistent audio policies")
            audio_policy = next(iter(policies))
            if audio_policy == "preserve_source" and not record["analysis"].get("audio_streams"):
                raise HTTPException(422, "The source video has no audio track to preserve")
            segments = []
            for index, shot in enumerate(expected, 1):
                task = by_shot[shot["id"]]
                media = self._media(db, task["output_media_id"])
                if media["kind"] != "generated_video":
                    raise HTTPException(409, f"Shot {index} output is not a generated video")
                if fingerprint(self._path(media["storage_path"])) != media["sha256"]:
                    raise HTTPException(409, f"Shot {index} generated video fingerprint changed")
                target = self._assembly_seconds(shot["start_pts"], shot["end_pts"], record["analysis"]["time_base"])
                segments.append({
                    "shot_id": shot["id"], "shot_number": index,
                    "start_pts": shot["start_pts"], "end_pts": shot["end_pts"],
                    "target_seconds": str(target), "generation_task_id": task["task_id"],
                    "generated_media_id": media["media_id"], "generated_sha256": media["sha256"],
                })
            active = db.execute(
                "SELECT COUNT(*) FROM recreation_assembly_tasks WHERE owner=? AND project_id=? "
                "AND generation_id=? AND json_extract(data, '$.status') IN ('pending','processing')",
                (self.user.owner_profile_id, project_id, generation_id),
            ).fetchone()[0]
            if active:
                raise HTTPException(409, "An assembly for this generation is already active")
            now = time.time()
            task = {
                "task_id": uuid4().hex, "project_id": project_id, "generation_id": generation_id,
                "revision": revision, "analysis_id": record["analysis_id"], "status": "pending",
                "audio_policy": audio_policy, "source_media_id": record["source_media_id"],
                "source_fingerprint": record["source_fingerprint"], "time_base": record["analysis"]["time_base"],
                "segments": segments, "output_media_id": None, "error": None,
                "created_at": now, "updated_at": now,
            }
            db.execute("INSERT INTO recreation_assembly_tasks VALUES (?, ?, ?, ?, ?)",
                       (task["task_id"], self.user.owner_profile_id, project_id, generation_id, json.dumps(task)))
            return self._public_assembly_task(db, task)

    def assembly_task(self, task_id):
        with self.db() as db:
            return self._public_assembly_task(db, self._assembly_task(db, task_id))

    def assembly_tasks(self, project_id, generation_id=None):
        with self.db() as db:
            self._get(db, project_id)
            conditions = ["owner=?", "project_id=?"]
            params = [self.user.owner_profile_id, project_id]
            if generation_id:
                conditions.append("generation_id=?")
                params.append(generation_id)
            rows = db.execute(
                "SELECT data FROM recreation_assembly_tasks WHERE " + " AND ".join(conditions) +
                " ORDER BY json_extract(data, '$.created_at') DESC, task_id DESC", params,
            ).fetchall()
            return [self._public_assembly_task(db, json.loads(row[0])) for row in rows]

    def cancel_assembly_task(self, task_id):
        with self.db() as db:
            task = self._assembly_task(db, task_id)
            if task["status"] not in ("pending", "processing"):
                raise HTTPException(409, "Recreation assembly task is no longer active")
            task.update(status="cancelled", error="Video assembly cancelled by user", updated_at=time.time())
            db.execute("UPDATE recreation_assembly_tasks SET data=? WHERE task_id=? AND owner=?",
                       (json.dumps(task), task_id, self.user.owner_profile_id))
            return self._public_assembly_task(db, task)

    def retry_assembly_task(self, task_id):
        with self.db() as db:
            task = self._assembly_task(db, task_id)
            if task["status"] != "failed":
                raise HTTPException(409, "Only a failed recreation assembly can be retried")
            task.update(status="pending", output_media_id=None, error=None, updated_at=time.time())
            db.execute("UPDATE recreation_assembly_tasks SET data=? WHERE task_id=? AND owner=?",
                       (json.dumps(task), task_id, self.user.owner_profile_id))
            return self._public_assembly_task(db, task)

    def process_assembly_task(self, task_id):
        folder = None
        try:
            with self.db() as db:
                task = self._assembly_task(db, task_id)
                if task["status"] != "pending":
                    return
                task.update(status="processing", updated_at=time.time())
                db.execute("UPDATE recreation_assembly_tasks SET data=? WHERE task_id=? AND owner=?",
                           (json.dumps(task), task_id, self.user.owner_profile_id))
                record = self._get(db, task["project_id"])
                if record["revision"] != task["revision"] or record["analysis_id"] != task["analysis_id"] or record["status"] != "confirmed":
                    raise ValueError("Timeline changed after assembly was submitted")
                source = self._media(db, task["source_media_id"])
                if source["sha256"] != task["source_fingerprint"] or fingerprint(self._path(source["storage_path"])) != task["source_fingerprint"]:
                    raise ValueError("Source fingerprint changed; register the source again")
                inputs = []
                for segment in task["segments"]:
                    media = self._media(db, segment["generated_media_id"])
                    if media["kind"] != "generated_video" or media["sha256"] != segment["generated_sha256"]:
                        raise ValueError(f"Shot {segment['shot_number']} generated video changed")
                    inputs.append((segment, self._path(media["storage_path"])))
                source_path = self._path(source["storage_path"])
            if self._assembly_cancelled(task_id):
                raise ValueError("Assembly task was cancelled")
            folder = self.root / task["project_id"] / "assemblies" / task_id
            segments_dir = folder / "segments"
            audio_dir = folder / "audio"
            segments_dir.mkdir(parents=True, exist_ok=True)
            if task["audio_policy"] == "preserve_source":
                audio_dir.mkdir(parents=True, exist_ok=True)
            normalized = []
            audio_segments = []
            total_duration = 0.0
            for segment, input_path in inputs:
                target = float(Fraction(segment["target_seconds"]))
                probe = self._probe_assembly_media(input_path)
                if probe["duration"] + 0.02 < target:
                    raise ValueError(
                        f"Shot {segment['shot_number']} generated video is {probe['duration']:.3f}s, "
                        f"shorter than the required {target:.3f}s; regenerate the shot"
                    )
                if task["audio_policy"] == "generated" and probe["audio_streams"] < 1:
                    raise ValueError(f"Shot {segment['shot_number']} has no generated audio track")
                output = segments_dir / f"shot-{segment['shot_number']:04d}.mp4"
                command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(input_path),
                           "-t", self._seconds_arg(target), "-map", "0:v:0", "-c:v", "libx264",
                           "-pix_fmt", "yuv420p"]
                if task["audio_policy"] == "generated":
                    command += ["-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"]
                else:
                    command += ["-an"]
                command.append(str(output))
                self._run_media_command(command)
                normalized.append(output)
                if task["audio_policy"] == "preserve_source":
                    audio_output = audio_dir / f"shot-{segment['shot_number']:04d}.m4a"
                    start = (int(segment["start_pts"]) - int(record["analysis"]["start_pts"])) * Fraction(task["time_base"])
                    audio_command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source_path),
                                     "-ss", self._seconds_arg(start), "-t", self._seconds_arg(target), "-map", "0:a:0",
                                     "-vn", "-c:a", "aac", "-ar", "48000", "-ac", "2", str(audio_output)]
                    self._run_media_command(audio_command)
                    audio_probe = self._probe_assembly_media(audio_output)
                    if audio_probe["audio_streams"] < 1 or audio_probe["duration"] + 0.02 < target:
                        raise ValueError(f"Source audio is shorter than shot {segment['shot_number']} duration")
                    audio_segments.append(audio_output)
                total_duration += target
                if self._assembly_cancelled(task_id):
                    raise ValueError("Assembly task was cancelled")
            video_list = folder / "video-list.txt"
            self._concat_list(video_list, normalized)
            video_only = folder / "video-only.mp4"
            video_command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                             "-i", str(video_list), "-map", "0:v:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(video_only)]
            self._run_media_command(video_command)
            output = folder / "final.mp4"
            if task["audio_policy"] == "generated":
                generated_list = folder / "generated-audio-list.txt"
                # The normalized generated segments carry their own audio. A
                # second concat pass with both streams keeps video/audio
                # packet boundaries aligned after per-shot cropping.
                self._concat_list(generated_list, normalized)
                mux_command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                               "-i", str(generated_list), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-c:a", "aac",
                               "-ar", "48000", "-ac", "2", "-movflags", "+faststart", str(output)]
                self._run_media_command(mux_command)
            elif task["audio_policy"] == "preserve_source":
                audio_list = folder / "audio-list.txt"
                self._concat_list(audio_list, audio_segments)
                source_audio = folder / "source-audio.m4a"
                self._run_media_command(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                                         "-i", str(audio_list), "-c:a", "aac", "-ar", "48000", "-ac", "2", str(source_audio)])
                self._run_media_command(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video_only), "-i", str(source_audio),
                                         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", str(output)])
            else:
                video_only.rename(output)
            final_probe = self._probe_assembly_media(output)
            if abs(final_probe["duration"] - total_duration) > 0.08:
                raise ValueError(f"Assembled video duration {final_probe['duration']:.3f}s does not match timeline {total_duration:.3f}s")
            if self._assembly_cancelled(task_id):
                raise ValueError("Assembly task was cancelled")
            item = {
                "media_id": uuid4().hex, "project_id": task["project_id"], "kind": "final_video",
                "display_name": f"Recreation final · {task['generation_id'][:8]}",
                "storage_path": output.relative_to(Path("output").resolve()).as_posix(),
                "sha256": fingerprint(output),
                "metadata": {"assembly_task_id": task_id, "generation_id": task["generation_id"],
                             "source_media_id": task["source_media_id"], "source_fingerprint": task["source_fingerprint"],
                             "audio_policy": task["audio_policy"], "revision": task["revision"],
                             "shot_task_ids": [segment["generation_task_id"] for segment in task["segments"]],
                             "shot_media_ids": [segment["generated_media_id"] for segment in task["segments"]],
                             "duration": final_probe["duration"], "audio_streams": final_probe["audio_streams"]},
                "created_at": time.time(),
            }
            with self.db() as db:
                current = self._assembly_task(db, task_id)
                if current["status"] != "processing":
                    raise ValueError("Assembly task was cancelled while FFmpeg was running")
                db.execute("INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                           (item["media_id"], self.user.owner_profile_id, task["project_id"], item["kind"],
                            item["display_name"], item["storage_path"], item["sha256"],
                            json.dumps(item["metadata"]), item["created_at"]))
                current.update(status="completed", output_media_id=item["media_id"], error=None, updated_at=time.time())
                db.execute("UPDATE recreation_assembly_tasks SET data=? WHERE task_id=? AND owner=?",
                           (json.dumps(current), task_id, self.user.owner_profile_id))
        except Exception as exc:
            if folder:
                shutil.rmtree(folder, ignore_errors=True)
            with self.db() as db:
                try:
                    current = self._assembly_task(db, task_id)
                except HTTPException:
                    return
                if current["status"] not in ("completed", "cancelled"):
                    current.update(status="failed", error=str(exc)[:1000], updated_at=time.time())
                    db.execute("UPDATE recreation_assembly_tasks SET data=? WHERE task_id=? AND owner=?",
                               (json.dumps(current), task_id, self.user.owner_profile_id))

    def reindex(self, project_id):
        with self.db() as db:
            record = self._get(db, project_id)
            if not record.get("analysis"):
                raise HTTPException(409, "Analysis is not ready")
            self._index_analysis(db, record)
        return record

    def start(self, project_id, revision):
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision:
                raise HTTPException(409, "Project changed; refresh before analyzing")
            if record["status"] in ("queued", "analyzing"):
                raise HTTPException(409, "Analysis already in progress")
            active = db.execute("SELECT COUNT(*) FROM projects WHERE json_extract(data, '$.status') IN ('queued','analyzing')").fetchone()[0]
            if active >= 2:
                raise HTTPException(429, "Analysis capacity is busy; retry later")
            attempt_id = uuid4().hex
            record.update(status="queued", error=None, analysis_id=attempt_id,
                          started_at=time.time(), attempt=record["attempt"] + 1,
                          analysis=None, timeline=None)
            self._save(db, record)
        return record

    def evidence(self, project_id, analysis_id, cut):
        record = self.get(project_id)
        if record["analysis_id"] != analysis_id or not record["analysis"]:
            raise HTTPException(409, "Analysis changed; refresh before selecting a cut")
        if fingerprint(self._path(record["source_url"])) != record["source_fingerprint"]:
            raise HTTPException(409, "Source fingerprint changed")
        for pair in [*record["analysis"]["candidates"], *record["analysis"].get("manual_evidence", {}).values()]:
            if pair["pts"] == cut:
                return pair
        pair = extract_pair(self._path(record["source_url"]),
                            self.root / project_id / analysis_id / uuid4().hex, record["analysis"], cut)
        with self.db() as db:
            current = self._get(db, project_id)
            if current["analysis_id"] != analysis_id or not current["analysis"]:
                raise HTTPException(409, "Analysis changed while extracting evidence")
            saved = current["analysis"].setdefault("manual_evidence", {})
            pair = saved.setdefault(str(cut), pair)
            self._index_analysis(db, current)
            # Evidence is additive; it must not invalidate the user's timeline revision.
            db.execute("UPDATE projects SET data=? WHERE id=? AND owner=?",
                       (json.dumps(current), project_id, self.user.owner_profile_id))
        return pair

    def process(self, project_id, attempt_id):
        with self.db() as db:
            record = self._get(db, project_id)
            if record["analysis_id"] != attempt_id or record["status"] != "queued":
                return
            record["status"] = "analyzing"
            self._save(db, record)
        try:
            result = analyze(self._path(record["source_url"]), self.root / project_id / attempt_id,
                             record["source_fingerprint"])
            error = None
        except Exception as exc:
            result = None
            error = str(exc) if isinstance(exc, ValueError) else "Analysis failed; retry or register another source"
        with self.db() as db:
            current = self._get(db, project_id)
            if current["analysis_id"] != attempt_id or current["status"] != "analyzing":
                return
            current.update(analysis=result, error=error, status="failed" if error else "review")
            if result:
                db.execute("SAVEPOINT media_index")
                try:
                    self._index_analysis(db, current)
                except Exception:
                    db.execute("ROLLBACK TO media_index")
                    current.update(status="failed", error="Media indexing failed; retry analysis", analysis=None)
                finally:
                    db.execute("RELEASE media_index")
            self._save(db, current)

    def confirm(self, project_id, revision, analysis_id, cuts):
        # Hashing is outside the write transaction; source files are immutable after registration.
        snapshot = self.get(project_id)
        if fingerprint(self._path(snapshot["source_url"])) != snapshot["source_fingerprint"]:
            raise HTTPException(409, "Source fingerprint changed; register the source again")
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["analysis_id"] != analysis_id:
                raise HTTPException(409, "Analysis changed; refresh before confirming")
            if record["status"] not in ("review", "confirmed") or not record["analysis"]:
                raise HTTPException(409, "Source analysis is not ready")
            analysis = record["analysis"]
            valid = set(analysis["frame_pts"][1:])
            if len(cuts) > 120 or cuts != sorted(set(cuts)) or any(type(p) is not int or p not in valid for p in cuts):
                raise HTTPException(422, "Cuts must be ordered unique source-frame PTS, excluding the start")
            boundaries = [analysis["start_pts"], *cuts, analysis["end_pts"]]
            detected = {c["pts"] for c in analysis["candidates"]}
            previous = record.get("timeline") or {}
            old_shots = {(shot["start_pts"], shot["end_pts"]): shot for shot in previous.get("shots", [])} if previous.get("analysis_id") == analysis_id else {}
            record["timeline"] = {"analysis_id": analysis_id, "source_fingerprint": record["source_fingerprint"],
                                  "time_base": analysis["time_base"], "confirmed_at": time.time(),
                                  "cuts": [{"pts": p, "source": "detected" if p in detected else "manual",
                                            "confirmed": True} for p in cuts],
                                  "shots": [old_shots.get((a, b), {"id": uuid4().hex, "start_pts": a, "end_pts": b})
                                            for a, b in zip(boundaries, boundaries[1:])]}
            record["status"] = "confirmed"
            self._save(db, record)
        return record
