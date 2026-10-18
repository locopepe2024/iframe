#!/usr/bin/env python3
"""Promote one reviewed platform reference candidate to active.

This is a deployment/release command, not a user-facing API. The content hash
check prevents approving a file that changed after review.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def promote(path: Path, resource_id: str, reviewer: str, expected_hash: str | None = None) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    resources = manifest.get("resources", [])
    resource = next((item for item in resources if item.get("platform_resource_id") == resource_id), None)
    if resource is None:
        raise ValueError(f"platform resource not found: {resource_id}")
    if resource.get("status") != "candidate":
        raise ValueError(f"platform resource is not a candidate: {resource_id}")
    actual_hash = resource.get("provenance", {}).get("content_sha256")
    if expected_hash and expected_hash != actual_hash:
        raise ValueError("content hash does not match reviewed candidate")
    resource["status"] = "active"
    resource["review"] = {
        "reviewer": reviewer,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "content_sha256": actual_hash,
    }
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return resource


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("resource_id")
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--expected-hash")
    parser.add_argument("--manifest", type=Path, default=Path("config/platform_reference_catalog/manifest.json"))
    args = parser.parse_args()
    resource = promote(args.manifest, args.resource_id, args.reviewer, args.expected_hash)
    print(f"Promoted {resource['platform_resource_id']} revision {resource['revision']} to active")


if __name__ == "__main__":
    main()
