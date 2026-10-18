"""Deployment-scoped platform reference catalog.

The catalog is intentionally file-backed in this first slice. API keys may
read active resources; promotion is restricted to the deployment reviewer
identity derived from the host iFrame configuration.
"""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
from typing import Any, Optional


CATALOG_ROOT = Path(__file__).resolve().parents[1] / ".." / "config" / "platform_reference_catalog"
PACKAGED_MANIFEST_PATH = CATALOG_ROOT / "manifest.json"
# Runtime approvals live on the persistent output mount, not in the container
# image. The packaged manifest seeds an installation only on first read.
MANIFEST_PATH = Path(os.getenv("IFRAME_PLATFORM_REFERENCE_MANIFEST", "output/platform_reference_catalog/manifest.json"))


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
    provenance = resource["provenance"]
    if not isinstance(provenance, dict) or not provenance.get("license") or not provenance.get("content_sha256"):
        raise ValueError("platform reference provenance requires license and content_sha256")


def _is_skill_card(resource: dict[str, Any]) -> bool:
    payload = resource.get("payload")
    metadata = payload.get("source_metadata", {}) if isinstance(payload, dict) else {}
    return isinstance(metadata, dict) and bool(metadata.get("skill_type"))


def list_resources(*, kind: Optional[str] = None, query: str = "", path: Path = MANIFEST_PATH) -> dict[str, Any]:
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
        if needle:
            haystack = " ".join([
                str(resource.get("title", "")),
                str(resource.get("summary", "")),
                " ".join(str(tag) for tag in resource.get("tags", [])),
                str(resource.get("kind", "")),
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


def list_review_candidates(*, kind: Optional[str] = None, query: str = "", path: Path = MANIFEST_PATH) -> dict[str, Any]:
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
        if needle:
            haystack = " ".join([
                str(resource.get("title", "")),
                str(resource.get("summary", "")),
                " ".join(str(tag) for tag in resource.get("tags", [])),
                str(resource.get("kind", "")),
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
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)
    return resource
