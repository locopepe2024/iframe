"""Owner-scoped source registration and durable, revision-checked analysis jobs."""
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import sqlite3
import time
import warnings
import re
from fractions import Fraction

from PIL import Image, UnidentifiedImageError
from uuid import uuid4

from fastapi import HTTPException

from ..identity import UserContext
from ..studio_access import studio_owner_dir
from .analysis import MAX_BYTES, analyze, extract_pair, fingerprint

LEASE_SECONDS = 600


class RecreationService:
    def __init__(self, user: UserContext):
        if not user.user_id or not user.owner_profile_id:
            raise ValueError("Authenticated owner required")
        self.user = user
        self.root = (Path(studio_owner_dir(user.owner_profile_id)) / "recreation").resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def db(self):
        connection = sqlite3.connect("output/recreation.sqlite3", timeout=10)
        try:
            connection.execute("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)")
            connection.execute("CREATE TABLE IF NOT EXISTS media_records (media_id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT, kind TEXT NOT NULL, display_name TEXT NOT NULL, storage_path TEXT NOT NULL, sha256 TEXT NOT NULL, metadata TEXT NOT NULL, created_at REAL NOT NULL)")
            connection.execute("CREATE INDEX IF NOT EXISTS media_owner_project ON media_records(owner, project_id, created_at, media_id)")
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
            record = self._get(db, project_id)
            if record["status"] in ("queued", "analyzing") and time.time() - record["started_at"] > LEASE_SECONDS:
                record.update(status="failed", error="Analysis interrupted or timed out; retry available")
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

    def bind_shot(self, project_id, shot_id, revision, analysis_id, reference_media_id, replacement_media_id, instruction, description=None):
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
            self._save(db, record)
        return record

    def generation_plan(self, project_id, revision):
        with self.db() as db:
            record = self._get(db, project_id)
            if record["revision"] != revision or record["status"] != "confirmed" or not record.get("timeline"):
                raise HTTPException(409, "Confirm the current timeline before preparing a plan")
            if fingerprint(self._path(record["source_url"])) != record["source_fingerprint"]:
                raise HTTPException(409, "Source fingerprint changed")
            shots, blockers = [], []
            for index, shot in enumerate(record["timeline"]["shots"], 1):
                description = shot.get("description", "").strip()
                instruction = shot.get("instruction", "").strip()
                missing = []
                if not description:
                    missing.append("description_required")
                if not shot.get("reference_media_id"):
                    missing.append("reference_required")
                if shot.get("replacement_media_id") and not instruction:
                    missing.append("replacement_instruction_required")
                if re.search(r"@|\b(?:picture|video|audio)\s*\d+", description + "\n" + instruction, re.I):
                    missing.append("media_labels_reserved")
                images = []
                for role in ("reference", "replacement"):
                    media_id = shot.get(role + "_media_id")
                    if media_id:
                        item = self._image(db, media_id)
                        images.append({"media_id": media_id, "sha256": item["sha256"], "role": role,
                                       "label": f"<Picture {len(images) + 1}>"})
                duration = (shot["end_pts"] - shot["start_pts"]) * Fraction(record["analysis"]["time_base"])
                prompt = None
                if missing:
                    blockers.append({"shot_id": shot["id"], "shot_number": index, "reasons": missing})
                else:
                    prompt = "Use <Picture 1> for composition, subject appearance and scene continuity.\n" + description
                    if shot.get("replacement_media_id"):
                        prompt += "\nUse <Picture 2> only for the replacement product appearance."
                    if instruction:
                        prompt += "\n" + instruction
                    prompt += "\nOne continuous shot, no added cuts. Silent output; no dialogue, music or sound effects."
                shots.append({"shot_id": shot["id"], "shot_number": index, "start_pts": shot["start_pts"],
                              "end_pts": shot["end_pts"], "target_duration": str(duration), "images": images, "prompt": prompt})
            return {"project_id": project_id, "revision": revision, "analysis_id": record["analysis_id"],
                    "time_base": record["analysis"]["time_base"], "audio_policy": "silent", "ready": not blockers,
                    "blockers": blockers, "shots": shots}

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
            if record["status"] in ("queued", "analyzing") and time.time() - record["started_at"] <= LEASE_SECONDS:
                raise HTTPException(409, "Analysis already in progress")
            active = db.execute("SELECT COUNT(*) FROM projects WHERE json_extract(data, '$.status') IN ('queued','analyzing') AND json_extract(data, '$.started_at') > ?",
                                (time.time() - LEASE_SECONDS,)).fetchone()[0]
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
