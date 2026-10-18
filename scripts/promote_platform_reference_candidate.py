#!/usr/bin/env python3
"""Promote one reviewed platform reference candidate to active.

This is a deployment/release command, not a user-facing API. The content hash
check prevents approving a file that changed after review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def reviewer_from_api_key(api_key: str) -> str:
    normalized = api_key.strip()
    if not normalized:
        raise ValueError("reviewer API key is empty")
    return "apikey-" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _find_config_value(value, key: str):
    if isinstance(value, dict):
        if isinstance(value.get(key), str) and value[key].strip():
            return value[key]
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


def reviewer_from_iframe_config(path: Path, key: str = "UNIART_API_KEY") -> str:
    if not path.exists():
        raise ValueError(f"iFrame config not found: {path}")
    config = json.loads(path.read_text(encoding="utf-8"))
    api_key = _find_config_value(config, key)
    if not api_key:
        raise ValueError(f"{key} not found in iFrame config")
    return reviewer_from_api_key(api_key)


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
    parser.add_argument("--reviewer")
    parser.add_argument("--reviewer-api-key-env", default="IFRAME_PLATFORM_REVIEW_API_KEY")
    parser.add_argument("--reviewer-config", type=Path, default=Path.home() / ".iframe" / "config.json")
    parser.add_argument("--reviewer-config-key", default="UNIART_API_KEY")
    parser.add_argument("--expected-hash")
    parser.add_argument("--manifest", type=Path, default=Path("config/platform_reference_catalog/manifest.json"))
    args = parser.parse_args()
    reviewer = args.reviewer
    if not reviewer:
        api_key = os.getenv(args.reviewer_api_key_env)
        if not api_key:
            try:
                reviewer = reviewer_from_iframe_config(args.reviewer_config, args.reviewer_config_key)
            except ValueError as exc:
                parser.error(f"provide --reviewer, set the reviewer API key environment variable, or use .iframe config: {exc}")
        else:
            reviewer = reviewer_from_api_key(api_key)
    resource = promote(args.manifest, args.resource_id, reviewer, args.expected_hash)
    print(f"Promoted {resource['platform_resource_id']} revision {resource['revision']} to active")


if __name__ == "__main__":
    main()
