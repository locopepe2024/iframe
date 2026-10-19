"""Deployment-scoped platform reference catalog.

The catalog is intentionally file-backed in this first slice. API keys may
read active resources; promotion is restricted to the deployment reviewer
identity derived from the host iFrame configuration.
"""
from __future__ import annotations

import json
import hashlib
import fcntl
import os
import re
import shutil
import threading
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


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


def list_resources(*, kind: Optional[str] = None, category: Optional[str] = None, tag: Optional[str] = None, query: str = "", semantic_domain: Optional[str] = None, entry_type: Optional[str] = None, path: Path = MANIFEST_PATH) -> dict[str, Any]:
    manifest = _read_manifest(path)
    needle = query.strip().casefold()
    resources = []
    for resource in manifest.get("resources", []):
        if resource.get("status") != "active":
            continue
        if _is_skill_card(resource):
            continue
        if kind and resource.get("kind") != kind:
            continue
        if category and resource.get("category_path") != category:
            continue
        if tag and tag not in resource.get("tags", []):
            continue
        dictionary = resource.get("dictionary") or {}
        if semantic_domain and dictionary.get("semantic_domain") != semantic_domain:
            continue
        if entry_type and dictionary.get("entry_type") != entry_type:
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
