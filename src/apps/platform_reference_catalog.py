"""Deployment-scoped platform reference catalog.

The catalog is intentionally file-backed in this first slice. API keys may
read active resources; promotion is restricted to the deployment reviewer
identity derived from the host iFrame configuration.
"""
from __future__ import annotations

import json
import hashlib
import fcntl
import gzip
import os
import re
import shutil
import threading
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


CATALOG_ROOT = Path(__file__).resolve().parents[1] / ".." / "config" / "platform_reference_catalog"
PACKAGED_MANIFEST_PATH = CATALOG_ROOT / "manifest.json"
# Runtime approvals live on the persistent output mount, not in the container
# image. The packaged manifest seeds an installation only on first read.
MANIFEST_PATH = Path(os.getenv("IFRAME_PLATFORM_REFERENCE_MANIFEST", "output/platform_reference_catalog/manifest.json"))
PUBLISHER_GRANTS_PATH = Path(os.getenv("IFRAME_PLATFORM_PUBLISHER_GRANTS", "output/platform_reference_catalog/publisher_grants.json"))
_MUTATION_LOCK = threading.RLock()
_PROFILE_ID = re.compile(r"^apikey-[0-9a-f]{64}$")


@contextmanager
def _file_lock(path: Path):
    """Serialize read-modify-write updates across web workers sharing a mount."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(path.suffix + ".lock").open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

CHARACTER_CATEGORIES = {
    "reference/pose": "姿势参考",
    "reference/costume": "服饰参考",
    "reference/character": "人物参考",
    "character/identity/face": "面容",
    "character/identity/skin": "皮肤",
    "character/identity/build": "身材体态",
    "character/identity/hair": "发型",
    "character/identity/marks": "识别标记",
    "character/look/clothing": "服装",
    "character/look/palette": "配色",
    "character/style": "风格",
    "character/performance": "表演",
    "character/reference": "角色参考",
}
DICTIONARY_DOMAINS = {
    "character/identity/": "character.identity",
    "character/look/": "character.look",
    "character/performance": "character.performance",
    "character/style": "world.style",
}


def validate_dictionary_label(kind: str, category_path: str, entry_type: str | None) -> dict[str, str] | None:
    if entry_type is None:
        return None
    domain = next((value for prefix, value in DICTIONARY_DOMAINS.items() if category_path.startswith(prefix)), None)
    if not domain or (entry_type, kind) not in {
        ("term", "prompt_preset"), ("pattern", "prompt_preset"), ("case", "image"), ("case", "video")
    }:
        raise ValueError("Dictionary type is incompatible with media kind or category")
    return {"semantic_domain": domain, "entry_type": entry_type}
CHARACTER_TAG_SUGGESTIONS = (
    "角色设定稿", "设定总览", "基准锚点", "转面三视图", "脸部特写", "表情表", "姿态参考",
    "服装拆解", "装备拆解", "配色卡", "识别标记", "世界观说明", "写实", "插画", "动漫", "三维", "古装", "现代",
)
MEDIA_EXTENSIONS = {"image": {".png", ".jpg", ".jpeg", ".webp"}, "video": {".mp4", ".mov", ".webm"}}
OPEN_POSE_PACK = CATALOG_ROOT / "open_pose_costume.json.gz"
REMOTE_IMAGE_HOSTS = {
    "ai-pose-gallery.pages.dev", "ai-pose-depth-gallery.pages.dev",
    "ai-costume-gallery.pages.dev", "ai-costume-anime-gallery.pages.dev",
    "ai-portrait-gallery.pages.dev", "raw.githubusercontent.com",
}


@lru_cache(maxsize=1)
def _open_pose_resources() -> dict[str, dict[str, Any]]:
    if not OPEN_POSE_PACK.is_file():
        return {}
    with gzip.open(OPEN_POSE_PACK, "rt", encoding="utf-8") as stream:
        pack = json.load(stream)
    return {item["platform_resource_id"]: item for item in pack["resources"]}


def platform_resource_by_id(resource_id: str, path: Path | None = None) -> dict[str, Any] | None:
    manifest_path = path or MANIFEST_PATH
    local = next((item for item in _read_manifest(manifest_path)["resources"]
                  if item["platform_resource_id"] == resource_id), None)
    if local:
        return local
    return _open_pose_resources().get(resource_id) if manifest_path == MANIFEST_PATH else None


class _NoImageRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("Reference image redirect is not allowed")


def _remote_image_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or parsed.hostname not in REMOTE_IMAGE_HOSTS or parsed.port not in (None, 443)
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path.lower().rsplit(".", 1)[-1] not in {"png", "jpg", "jpeg", "webp"}):
        raise ValueError("Reference image origin is not allowed")
    return value


def _materialize_remote_image(resource: dict[str, Any], manifest_path: Path) -> Path:
    from PIL import Image

    payload = resource["payload"]
    url = _remote_image_url(payload["remote_url"])
    suffix = Path(urlsplit(url).path).suffix.lower()
    cache_dir = manifest_path.parent / "remote_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(f"{resource['platform_resource_id']}:{resource['revision']}:{url}".encode()).hexdigest() + suffix
    destination = cache_dir / name
    with _MUTATION_LOCK, _file_lock(destination):
        if destination.is_file():
            expected_hash = payload.get("media_sha256")
            if not expected_hash or hashlib.sha256(destination.read_bytes()).hexdigest() == expected_hash:
                return destination
            destination.unlink()
        temporary = cache_dir / f".{uuid.uuid4().hex}.tmp"
        try:
            opener = build_opener(_NoImageRedirect)
            with opener.open(Request(url, headers={"User-Agent": "iFrame-Reference/1.0"}), timeout=30) as response, temporary.open("wb") as output:
                size = 0
                digest = hashlib.sha256()
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    size += len(chunk)
                    if size > 20 * 1024 * 1024:
                        raise ValueError("Reference image exceeds 20 MiB")
                    digest.update(chunk)
                    output.write(chunk)
            if not size or (payload.get("media_sha256") and digest.hexdigest() != payload["media_sha256"]):
                raise ValueError("Reference image content hash is invalid")
            with Image.open(temporary) as image:
                expected = "jpeg" if suffix in {".jpg", ".jpeg"} else suffix.removeprefix(".")
                if (image.format or "").lower() != expected or not 0 < image.width * image.height <= 50_000_000:
                    raise ValueError("Reference image format or dimensions are invalid")
                image.verify()
            os.replace(temporary, destination)
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError("Reference image could not be fetched or decoded") from exc
        finally:
            temporary.unlink(missing_ok=True)
    return destination


def normalize_character_tags(values: list[str]) -> list[str]:
    if len(values) > 12:
        raise ValueError("Platform character tags are limited to 12")
    normalized = []
    seen = set()
    for value in values:
        if not isinstance(value, str):
            raise ValueError("Platform character tags must be text")
        tag = unicodedata.normalize("NFC", value).strip()
        if not tag or len(tag) > 32 or any(unicodedata.category(char).startswith("C") for char in tag):
            raise ValueError("Platform character tag is empty, too long or contains control characters")
        identity = tag.casefold()
        if identity not in seen:
            seen.add(identity)
            normalized.append(tag)
    return normalized


def publisher_is_authorized(owner_profile_id: str, path: Path = PUBLISHER_GRANTS_PATH) -> bool:
    if reviewer_is_authorized(owner_profile_id):
        return True
    if not _PROFILE_ID.fullmatch(owner_profile_id):
        return False
    if not path.exists():
        return False
    payload = json.loads(path.read_text(encoding="utf-8"))
    return owner_profile_id in payload.get("publisher_profile_ids", [])


def list_publisher_grants(path: Path = PUBLISHER_GRANTS_PATH) -> list[str]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return sorted(value for value in payload.get("publisher_profile_ids", []) if _PROFILE_ID.fullmatch(value))


def set_publisher_grant(owner_profile_id: str, enabled: bool, path: Path = PUBLISHER_GRANTS_PATH) -> list[str]:
    if not _PROFILE_ID.fullmatch(owner_profile_id):
        raise ValueError("Publisher identity must be a server-derived API key profile ID")
    with _MUTATION_LOCK, _file_lock(path):
        values = set(list_publisher_grants(path))
        if enabled:
            values.add(owner_profile_id)
        else:
            values.discard(owner_profile_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"schema_version": 1, "publisher_profile_ids": sorted(values)}, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
        return sorted(values)


def submit_generation_candidate(
    *,
    creator_profile_id: str,
    generation_id: str,
    output_id: str | None,
    kind: str,
    category_path: str,
    tags: list[str] | None = None,
    title: str,
    description: str,
    prompt_used: str,
    negative_prompt: str | None = None,
    model_id: str,
    parameters: dict[str, Any],
    media_source: Path | None,
    media_owner_root: Path,
    rights_confirmed: bool,
    dictionary_entry_type: str | None = None,
    dictionary_members: list[dict[str, Any]] | None = None,
    path: Path = MANIFEST_PATH,
) -> dict[str, Any]:
    """Freeze an owned Playground result as a review candidate, never as active content."""
    if not publisher_is_authorized(creator_profile_id):
        raise PermissionError("Platform candidate submission is not authorized")
    if kind not in {"image", "video", "prompt_preset"} or category_path not in CHARACTER_CATEGORIES:
        raise ValueError("Platform candidate kind or category is invalid")
    if category_path.startswith("reference/") and kind != "image":
        raise ValueError("Shared visual references must be images")
    dictionary = validate_dictionary_label(kind, category_path, dictionary_entry_type)
    if dictionary_entry_type != "pattern" and dictionary_members:
        raise ValueError("Dictionary members require a pattern")
    tags = normalize_character_tags(tags or [])
    if not rights_confirmed:
        raise ValueError("Creator rights confirmation is required")
    title, description = title.strip(), description.strip()
    if not title or len(title) > 200 or not description or len(description) > 20000 or not prompt_used.strip():
        raise ValueError("Candidate title, description or source prompt is invalid")
    if dictionary_entry_type == "term" and (len(description) > 500 or "\n" in description):
        raise ValueError("Dictionary term must be a single editable phrase of at most 500 characters")
    if kind == "prompt_preset" and media_source is not None:
        raise ValueError("Prompt presets cannot attach a media output")
    if kind != "prompt_preset" and (media_source is None or not output_id):
        raise ValueError("Image and video candidates require an output")

    media_hash = None
    media_suffix = None
    source = None
    if media_source is not None:
        source = media_source.resolve(strict=True)
        owner_root = media_owner_root.resolve(strict=True)
        if not source.is_file() or not source.is_relative_to(owner_root):
            raise ValueError("Candidate media is outside the owned Playground directory")
        media_suffix = source.suffix.lower()
        if media_suffix not in MEDIA_EXTENSIONS[kind] or source.stat().st_size > 512 * 1024 * 1024:
            raise ValueError("Candidate media type or size is invalid")
        digest = hashlib.sha256()
        with source.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        media_hash = digest.hexdigest()

    payload = {
        "source_generation_id": generation_id,
        "source_output_id": output_id,
        "prompt_used": prompt_used,
        "negative_prompt": negative_prompt,
        "structured_prompt": {"content": description},
        "model_id": model_id,
        "parameters": parameters,
        "media_sha256": media_hash,
    }
    fingerprint = hashlib.sha256(json.dumps(
        [creator_profile_id, kind, category_path, sorted(tags, key=str.casefold), title, payload]
        + ([dictionary] if dictionary else []), ensure_ascii=False, sort_keys=True,
    ).encode("utf-8")).hexdigest()
    with _MUTATION_LOCK, _file_lock(path):
        manifest = _read_manifest(path)
        if dictionary_entry_type == "pattern":
            dictionary["members"] = _validate_pattern_members(dictionary_members, dictionary["semantic_domain"], manifest["resources"])
            fingerprint = hashlib.sha256(json.dumps(
                [creator_profile_id, kind, category_path, sorted(tags, key=str.casefold), title, payload, dictionary],
                ensure_ascii=False, sort_keys=True,
            ).encode("utf-8")).hexdigest()
        existing = next((item for item in manifest["resources"] if item.get("provenance", {}).get("content_sha256") == fingerprint), None)
        if existing:
            return existing
        media_file = None
        if source is not None:
            media_file = f"{media_hash}{media_suffix}"
            media_dir = path.parent / "media"
            media_dir.mkdir(parents=True, exist_ok=True)
            destination = media_dir / media_file
            if not destination.exists():
                temporary = media_dir / f".{uuid.uuid4().hex}.tmp"
                try:
                    shutil.copyfile(source, temporary)
                    copied_digest = hashlib.sha256()
                    with temporary.open("rb") as copied:
                        for chunk in iter(lambda: copied.read(1024 * 1024), b""):
                            copied_digest.update(chunk)
                    if copied_digest.hexdigest() != media_hash:
                        raise ValueError("Candidate media changed during copy")
                    os.replace(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
        resource = {
            "platform_resource_id": f"iframe.creative.{uuid.uuid4().hex}",
            "revision": 1,
            "kind": kind,
            "category_path": category_path,
            **({"dictionary": dictionary} if dictionary else {}),
            "tags": tags,
            "title": title,
            "summary": description,
            "status": "candidate",
            "payload": {**payload, "media_file": media_file},
            "provenance": {
                "source": "iframe-playground", "creator_profile_id": creator_profile_id,
                "license": "creator_declared_pending_review", "content_sha256": fingerprint,
                "rights_confirmed": True,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            },
        }
        manifest["resources"].append(resource)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_manifest = path.with_suffix(".tmp")
        temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary_manifest, path)
        return resource


def submit_uploaded_visual_candidate(
    *, creator_profile_id: str, category_path: str, title: str, description: str,
    tags: list[str], media_source: Path, media_owner_root: Path,
    rights_confirmed: bool, rights_note: str, source_url: str = "",
    path: Path | None = None,
) -> dict[str, Any]:
    """Stage one owner-uploaded visual reference for the existing platform review queue."""
    if not publisher_is_authorized(creator_profile_id):
        raise PermissionError("Platform candidate submission is not authorized")
    if category_path not in {"reference/pose", "reference/costume", "reference/character"}:
        raise ValueError("Visual reference category is invalid")
    title, description, rights_note, source_url = (
        value.strip() for value in (title, description, rights_note, source_url)
    )
    if not rights_confirmed or not rights_note or len(rights_note) > 2000:
        raise ValueError("Publishing rights and their source must be confirmed")
    if not title or len(title) > 200 or len(description) > 20000:
        raise ValueError("Visual reference title or description is invalid")
    if source_url:
        parsed = urlsplit(source_url)
        if len(source_url) > 2048 or parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("Visual reference source URL is invalid")
    tags = normalize_character_tags(tags)
    source = media_source.resolve(strict=True)
    owner_root = media_owner_root.resolve(strict=True)
    if not source.is_file() or not source.is_relative_to(owner_root):
        raise ValueError("Visual reference image is outside the owner's uploads")
    suffix = source.suffix.lower()
    if suffix not in MEDIA_EXTENSIONS["image"] or not 0 < source.stat().st_size <= 20 * 1024 * 1024:
        raise ValueError("Visual reference image type or size is invalid")
    from PIL import Image
    try:
        with Image.open(source) as image:
            expected_format = "jpeg" if suffix in {".jpg", ".jpeg"} else suffix.removeprefix(".")
            if (image.format or "").lower() != expected_format or not 0 < image.width * image.height <= 50_000_000:
                raise ValueError("Visual reference image format or dimensions are invalid")
            image.verify()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Visual reference image cannot be decoded") from exc
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest_path = path or MANIFEST_PATH
    fingerprint = hashlib.sha256(json.dumps(
        [creator_profile_id, category_path, title, description, tags, digest, rights_note, source_url],
        ensure_ascii=False, sort_keys=True,
    ).encode("utf-8")).hexdigest()
    with _MUTATION_LOCK, _file_lock(manifest_path):
        manifest = _read_manifest(manifest_path)
        existing = next((item for item in manifest["resources"]
                         if item.get("provenance", {}).get("content_sha256") == fingerprint), None)
        if existing:
            return existing
        media_file = f"{digest}{suffix}"
        media_dir = manifest_path.parent / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        destination = media_dir / media_file
        if not destination.exists():
            temporary = media_dir / f".{uuid.uuid4().hex}.tmp"
            try:
                shutil.copyfile(source, temporary)
                if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
                    raise ValueError("Visual reference image changed during copy")
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
        resource = {
            "platform_resource_id": f"iframe.reference.{uuid.uuid4().hex}",
            "revision": 1, "kind": "image", "category_path": category_path,
            "tags": tags, "title": title, "summary": description,
            "status": "candidate", "payload": {"media_file": media_file, "media_sha256": digest},
            "provenance": {
                "source": "owner-upload", "creator_profile_id": creator_profile_id,
                "source_url": source_url or None, "notice_text": rights_note,
                "license": "creator_declared_pending_review", "content_sha256": fingerprint,
                "rights_confirmed": True, "submitted_at": datetime.now(timezone.utc).isoformat(),
            },
        }
        manifest["resources"].append(resource)
        temporary_manifest = manifest_path.with_suffix(".tmp")
        temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary_manifest, manifest_path)
        return resource


def _default_review_config() -> Path:
    # Production iFrame hosts keep the deployment credential in /opt/.iframe.
    # Older hosts use that path as a one-line key file; packaged installs use
    # config.json under the application data directory. Neither path creates
    # or stores a browser-side reviewer credential.
    for host_config in (Path("/run/iframe-review-key"), Path("/opt/.iframe")):
        if host_config.exists():
            return host_config
    from ..utils import get_user_data_dir

    return Path(get_user_data_dir()) / "config.json"


def _find_config_value(value: Any, key: str) -> Optional[str]:
    if isinstance(value, dict):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        for child in value.values():
            found = _find_config_value(child, key)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_config_value(child, key)
            if found:
                return found
    return None


def configured_reviewer_identity(
    config_path: Path | None = None,
    key_name: str | None = None,
) -> Optional[str]:
    """Return the server configured reviewer identity without exposing its key."""
    configured_path = os.getenv("IFRAME_PLATFORM_REVIEW_CONFIG", "").strip()
    if config_path is not None:
        path = config_path
    elif configured_path:
        path = Path(configured_path).expanduser()
    else:
        path = _default_review_config()
    field = key_name or os.getenv("IFRAME_PLATFORM_REVIEW_KEY_FIELD", "UNIART_API_KEY")
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    key: Optional[str]
    if path.is_file() and (
        path.name == ".iframe"
        or any(line.lstrip().startswith(("api_key=", f"{field}=")) for line in raw.splitlines())
    ):
        key = None
        for line in raw.splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() in {field, "api_key"}:
                key = value.strip()
                break
        if not key and raw.strip():
            key = raw.strip()
    else:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        key = _find_config_value(payload, field)
    if not key:
        return None
    return "apikey-" + hashlib.sha256(key.encode("utf-8")).hexdigest()


def reviewer_is_authorized(owner_profile_id: str, config_path: Path | None = None) -> bool:
    expected = configured_reviewer_identity(config_path)
    return bool(expected and owner_profile_id == expected)


def _read_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    if not path.exists():
        if path != MANIFEST_PATH or not PACKAGED_MANIFEST_PATH.exists():
            return {"schema_version": 1, "catalog_revision": "empty", "resources": []}
        source = PACKAGED_MANIFEST_PATH
    else:
        source = path
    payload = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise ValueError("platform reference catalog schema is invalid")
    resources = payload.get("resources", [])
    if not isinstance(resources, list):
        raise ValueError("platform reference catalog resources must be a list")
    for resource in resources:
        _validate_resource(resource)
    return payload


def _validate_resource(resource: Any) -> None:
    if not isinstance(resource, dict):
        raise ValueError("platform reference resource must be an object")
    required = ("platform_resource_id", "revision", "kind", "title", "status", "provenance")
    missing = [key for key in required if key not in resource]
    if missing:
        raise ValueError(f"platform reference resource missing: {', '.join(missing)}")
    if not isinstance(resource["platform_resource_id"], str) or not resource["platform_resource_id"].strip():
        raise ValueError("platform_resource_id is required")
    if not isinstance(resource["revision"], int) or resource["revision"] < 1:
        raise ValueError("platform reference revision is invalid")
    if resource["status"] not in ("candidate", "review", "active", "retired"):
        raise ValueError("platform reference status is invalid")
    category = resource.get("category_path")
    if category is not None and (not isinstance(category, str) or not category.strip()):
        raise ValueError("platform reference category is invalid")
    if isinstance(category, str) and category.startswith("reference/") and resource.get("kind") != "image":
        raise ValueError("shared visual references must be images")
    if "tags" in resource and (not isinstance(resource["tags"], list) or any(not isinstance(tag, str) for tag in resource["tags"])):
        raise ValueError("platform reference tags are invalid")
    if "dictionary" in resource:
        dictionary = resource["dictionary"]
        if not isinstance(dictionary, dict):
            raise ValueError("platform reference dictionary label is invalid")
        expected = validate_dictionary_label(
            resource.get("kind", ""), resource.get("category_path", ""), dictionary.get("entry_type")
        )
        if expected and dictionary.get("entry_type") == "pattern":
            members = dictionary.get("members")
            if not isinstance(members, list) or not 2 <= len(members) <= 12 or any(
                not isinstance(member, dict) or set(member) != {"platform_resource_id", "revision", "role"}
                or not isinstance(member["platform_resource_id"], str) or not member["platform_resource_id"]
                or type(member["revision"]) is not int or member["revision"] < 1
                or not isinstance(member["role"], str) or not member["role"].strip()
                for member in members
            ):
                raise ValueError("platform reference pattern members are invalid")
            expected["members"] = members
        if dictionary != expected:
            raise ValueError("platform reference dictionary label is invalid")
    provenance = resource["provenance"]
    if not isinstance(provenance, dict) or not provenance.get("license") or not provenance.get("content_sha256"):
        raise ValueError("platform reference provenance requires license and content_sha256")


def _validate_pattern_members(members: list[dict[str, Any]] | None, domain: str, resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(members, list) or not 2 <= len(members) <= 12:
        raise ValueError("Pattern requires 2–12 published terms")
    normalized = []
    seen = set()
    for member in members:
        if not isinstance(member, dict) or set(member) != {"platform_resource_id", "revision", "role"}:
            raise ValueError("Pattern member identity, revision and role are required")
        resource_id, revision, role = member["platform_resource_id"], member["revision"], member["role"]
        if not isinstance(resource_id, str) or type(revision) is not int or not isinstance(role, str) or not role.strip() or len(role) > 80:
            raise ValueError("Pattern member is invalid")
        identity = (resource_id, revision)
        if identity in seen:
            raise ValueError("Pattern members must be unique")
        seen.add(identity)
        target = next((item for item in resources if item.get("platform_resource_id") == resource_id and item.get("revision") == revision), None)
        if not target or target.get("status") != "active" or target.get("dictionary") != {"semantic_domain": domain, "entry_type": "term"}:
            raise ValueError("Pattern member must reference an active term in the same domain and revision")
        normalized.append({"platform_resource_id": resource_id, "revision": revision, "role": role.strip()})
    return normalized


def _is_skill_card(resource: dict[str, Any]) -> bool:
    payload = resource.get("payload")
    metadata = payload.get("source_metadata", {}) if isinstance(payload, dict) else {}
    return isinstance(metadata, dict) and bool(metadata.get("skill_type"))


def list_resources(*, kind: Optional[str] = None, category: Optional[str] = None, tag: Optional[str] = None, query: str = "", semantic_domain: Optional[str] = None, entry_type: Optional[str] = None, visual_only: bool = False, path: Path = MANIFEST_PATH) -> dict[str, Any]:
    manifest = _read_manifest(path)
    needle = query.strip().casefold()
    resources = []
    category_counts: dict[str, int] = {}
    tag_counts: dict[str, int] = {}
    source_resources = dict(_open_pose_resources()) if path == MANIFEST_PATH else {}
    source_resources.update((item["platform_resource_id"], item) for item in manifest.get("resources", []))
    for resource in source_resources.values():
        if resource.get("status") != "active":
            continue
        if _is_skill_card(resource):
            continue
        if kind and resource.get("kind") != kind:
            continue
        if visual_only and not (resource.get("kind") == "image"
                and resource.get("category_path", "").startswith("reference/")
                and (resource.get("payload", {}).get("media_file") or resource.get("payload", {}).get("remote_url"))):
            continue
        dictionary = resource.get("dictionary") or {}
        if semantic_domain and dictionary.get("semantic_domain") != semantic_domain:
            continue
        if entry_type and dictionary.get("entry_type") != entry_type:
            continue
        # Facets cover the complete eligible catalog, never just one result page.
        # Keep categories stable; tags narrow by category, independently of search/tag.
        category_id = resource.get("category_path", "")
        if category_id:
            category_counts[category_id] = category_counts.get(category_id, 0) + 1
        if category and category_id != category:
            continue
        for resource_tag in set(resource.get("tags", [])):
            tag_counts[resource_tag] = tag_counts.get(resource_tag, 0) + 1
        if tag and tag not in resource.get("tags", []):
            continue
        if needle:
            haystack = " ".join([
                str(resource.get("title", "")),
                str(resource.get("summary", "")),
                " ".join(str(tag) for tag in resource.get("tags", [])),
                str(resource.get("kind", "")),
                str(resource.get("category_path", "")),
            ]).casefold()
            if needle not in haystack:
                continue
        resources.append(resource)
    return {
        "scope": "platform_shared",
        "schema_version": manifest.get("schema_version", 1),
        "catalog_revision": manifest.get("catalog_revision", "unknown"),
        "resources": resources,
        "facets": {
            "categories": [{"id": key, "label": CHARACTER_CATEGORIES.get(key, key), "count": count}
                           for key, count in sorted(category_counts.items())],
            "tags": [{"id": key, "label": key, "count": count} for key, count in sorted(tag_counts.items())],
        },
    }


def resolve_active_visual_reference(resource_id: str, revision: int, path: Path | None = None) -> Path:
    """Resolve one published platform image without exposing storage paths to clients."""
    manifest_path = path or MANIFEST_PATH
    resource = platform_resource_by_id(resource_id, manifest_path)
    if (resource is None or resource["status"] != "active"
            or resource["revision"] != revision or resource["kind"] != "image"
            or not str(resource.get("category_path", "")).startswith("reference/")):
        raise ValueError("platform reference is unavailable or its revision changed")
    payload = resource.get("payload")
    if resource is _open_pose_resources().get(resource_id) and isinstance(payload, dict) and payload.get("remote_url"):
        return _materialize_remote_image(resource, manifest_path)
    filename = payload.get("media_file") if isinstance(payload, dict) else None
    if not isinstance(filename, str) or Path(filename).name != filename:
        raise ValueError("platform reference image is missing")
    media_root = (manifest_path.parent / "media").resolve()
    media = (media_root / filename).resolve()
    if (not media.is_relative_to(media_root) or not media.is_file()
            or media.suffix.lower() not in MEDIA_EXTENSIONS["image"]):
        raise ValueError("platform reference image is missing")
    return media


def list_review_candidates(*, kind: Optional[str] = None, category: Optional[str] = None, tag: Optional[str] = None, query: str = "", path: Path = MANIFEST_PATH) -> dict[str, Any]:
    """Return unpublished candidates for the deployment reviewer queue.

    The public catalog deliberately exposes active resources only; review UI
    callers must use this separate, server-authorized boundary.
    """
    manifest = _read_manifest(path)
    needle = query.strip().casefold()
    resources = []
    for resource in manifest.get("resources", []):
        if resource.get("status") not in ("candidate", "review"):
            continue
        if kind and resource.get("kind") != kind:
            continue
        if category and resource.get("category_path") != category:
            continue
        if tag and tag not in resource.get("tags", []):
            continue
        if needle:
            haystack = " ".join([
                str(resource.get("title", "")),
                str(resource.get("summary", "")),
                " ".join(str(tag) for tag in resource.get("tags", [])),
                str(resource.get("kind", "")),
                str(resource.get("category_path", "")),
            ]).casefold()
            if needle not in haystack:
                continue
        resources.append(resource)
    return {
        "scope": "platform_shared",
        "schema_version": manifest.get("schema_version", 1),
        "catalog_revision": manifest.get("catalog_revision", "unknown"),
        "resources": resources,
    }


def promote_resource(
    resource_id: str,
    reviewer_identity: str,
    expected_hash: Optional[str] = None,
    path: Path = MANIFEST_PATH,
) -> dict[str, Any]:
    with _MUTATION_LOCK, _file_lock(path):
        manifest = _read_manifest(path)
        resource = next((item for item in manifest["resources"] if item.get("platform_resource_id") == resource_id), None)
        if resource is None:
            raise ValueError("platform resource not found")
        if resource.get("status") != "candidate":
            raise ValueError("platform resource is not a candidate")
        actual_hash = resource.get("provenance", {}).get("content_sha256")
        if expected_hash and expected_hash != actual_hash:
            raise ValueError("content hash does not match reviewed candidate")
        resource["status"] = "active"
        resource["review"] = {
            "reviewer": reviewer_identity,
            "content_sha256": actual_hash,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
        return resource
