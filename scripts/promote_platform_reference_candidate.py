#!/usr/bin/env python3
"""Promote one reviewed platform reference candidate to active.

This is a deployment/release command, not a user-facing API. The content hash
check prevents approving a file that changed after review.
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path

from src.apps.platform_reference_catalog import configured_reviewer_identity, promote_resource
from src.utils import get_user_data_dir


def reviewer_from_api_key(api_key: str) -> str:
    normalized = api_key.strip()
    if not normalized:
        raise ValueError("reviewer API key is empty")
    return "apikey-" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def reviewer_from_iframe_config(path: Path, key: str = "UNIART_API_KEY") -> str:
    identity = configured_reviewer_identity(path, key)
    if not identity:
        raise ValueError(f"{key} not found in iFrame config")
    return identity


def promote(path: Path, resource_id: str, reviewer: str, expected_hash: str | None = None) -> dict:
    return promote_resource(resource_id, reviewer, expected_hash, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("resource_id")
    parser.add_argument("--reviewer")
    parser.add_argument("--reviewer-api-key-env", default="IFRAME_PLATFORM_REVIEW_API_KEY")
    parser.add_argument("--reviewer-config", type=Path)
    parser.add_argument("--reviewer-config-key", default="UNIART_API_KEY")
    parser.add_argument("--expected-hash")
    parser.add_argument("--manifest", type=Path, default=Path("config/platform_reference_catalog/manifest.json"))
    args = parser.parse_args()
    reviewer = args.reviewer
    if not reviewer:
        api_key = os.getenv(args.reviewer_api_key_env)
        if not api_key:
            config_path = args.reviewer_config or Path(get_user_data_dir()) / "config.json"
            try:
                reviewer = reviewer_from_iframe_config(config_path, args.reviewer_config_key)
            except ValueError as exc:
                parser.error(f"provide --reviewer, set the reviewer API key environment variable, or use .iframe config: {exc}")
        else:
            reviewer = reviewer_from_api_key(api_key)
    resource = promote(args.manifest, args.resource_id, reviewer, args.expected_hash)
    print(f"Promoted {resource['platform_resource_id']} revision {resource['revision']} to active")


if __name__ == "__main__":
    main()
