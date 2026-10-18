#!/usr/bin/env python3
"""Import explicitly allowlisted open-ai-canvas references as review candidates.

This command never activates resources. It produces a manifest whose entries
remain ``candidate`` until provenance, license and quality review is complete.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    _, header, body = text.split("---", 2)
    values: dict[str, Any] = {}
    for line in header.splitlines():
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", line.strip())
        if not match:
            continue
        key, value = match.groups()
        value = value.strip().strip('"')
        if value.startswith("[") and value.endswith("]"):
            value = [item.strip().strip('"\'') for item in value[1:-1].split(",") if item.strip()]
        values[key] = value
    return values, body.lstrip("\n")


def _git_commit(root: Path) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def import_candidates(source_root: Path, allowlist_path: Path, existing_manifest: Path) -> dict[str, Any]:
    allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    if not isinstance(allowlist, list):
        raise ValueError("allowlist must be a list")
    resources = []
    commit = _git_commit(source_root)
    imported_at = datetime.now(timezone.utc).isoformat()
    for item in allowlist:
        relative = Path(str(item.get("path", "")))
        source = (source_root / relative).resolve()
        if source_root.resolve() not in source.parents:
            raise ValueError(f"allowlist path escapes source root: {relative}")
        if not source.is_file():
            raise ValueError(f"allowlist source is missing: {relative}")
        text = source.read_text(encoding="utf-8")
        metadata, body = _frontmatter(text)
        license_name = str(metadata.get("source_license") or item.get("expected_license") or "").strip()
        expected = str(item.get("expected_license") or "").strip()
        if expected and license_name != expected:
            raise ValueError(f"license mismatch for {relative}: {license_name!r} != {expected!r}")
        if not license_name:
            raise ValueError(f"missing license for {relative}")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        source_name = str(metadata.get("name") or relative.stem)
        resource_id = f"open-ai-canvas.{item.get('kind', 'reference')}.{source_name}.v1"
        resources.append({
            "platform_resource_id": resource_id,
            "revision": 1,
            "kind": item.get("kind", "reference"),
            "title": source_name,
            "summary": str(metadata.get("description") or "").strip(),
            "tags": metadata.get("tags", []),
            "status": "candidate",
            "payload": {
                "source_path": str(relative),
                "source_text": body,
                "source_metadata": metadata,
            },
            "provenance": {
                "source": "open-ai-canvas",
                "source_repository": "open-ai-canvas",
                "source_commit": commit,
                "source_path": str(relative),
                "source_url": metadata.get("source_url"),
                "license": license_name,
                "attribution": metadata.get("attribution"),
                "content_sha256": digest,
                "imported_at": imported_at,
            },
        })
    existing = {"schema_version": 1, "catalog_revision": "imported", "resources": []}
    if existing_manifest.exists():
        existing = json.loads(existing_manifest.read_text(encoding="utf-8"))
    previous = {
        item["platform_resource_id"]: item
        for item in existing.get("resources", [])
        if isinstance(item, dict) and item.get("platform_resource_id")
    }
    previous.update({item["platform_resource_id"]: item for item in resources})
    existing["catalog_revision"] = f"open-ai-canvas-{commit[:12]}"
    existing["resources"] = sorted(previous.values(), key=lambda item: item["platform_resource_id"])
    return existing


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--allowlist", type=Path, default=Path("config/platform_reference_catalog/open_ai_canvas.allowlist.json"))
    parser.add_argument("--manifest", type=Path, default=Path("config/platform_reference_catalog/manifest.json"))
    args = parser.parse_args()
    result = import_candidates(args.source_root, args.allowlist, args.manifest)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(result['resources'])} candidate platform references into {args.manifest}")


if __name__ == "__main__":
    main()
