"""Deployment-scoped, read-only platform reference catalog.

The catalog is intentionally file-backed in this first slice. API keys may
read active resources, but no user request can mutate this directory. Import
and promotion will be added behind a separate manifest/review workflow.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional


CATALOG_ROOT = Path(__file__).resolve().parents[1] / ".." / "config" / "platform_reference_catalog"
MANIFEST_PATH = CATALOG_ROOT / "manifest.json"


def _read_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "catalog_revision": "empty", "resources": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
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


def list_resources(*, kind: Optional[str] = None, query: str = "", path: Path = MANIFEST_PATH) -> dict[str, Any]:
    manifest = _read_manifest(path)
    needle = query.strip().casefold()
    resources = []
    for resource in manifest.get("resources", []):
        if resource.get("status") != "active":
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

