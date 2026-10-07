#!/usr/bin/env python3
"""Migrate persisted Studio material references to owner-scoped media IDs."""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.apps.media_registry import get_media, register_media


STORE_NAMES = ("projects.json", "series.json", "library_assets.json")


def storage_key(value: object, output_root: Path) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme in ("http", "https"):
        return None
    root = output_root.resolve()
    candidate = Path(value)
    if candidate.is_absolute():
        try:
            return candidate.resolve().relative_to(root).as_posix()
        except ValueError:
            return None
    if value.startswith("output/"):
        value = value[7:]
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return value


def migrate_store(path: Path, output_root: Path, apply: bool, report: dict,
                  owner_overrides: dict[str, str] | None = None) -> None:
    if not path.exists():
        return
    original = json.loads(path.read_text())
    data = copy.deepcopy(original)

    def walk(node, owner: str | None, location: str, parent_key: str = ""):
        if isinstance(node, dict):
            current_owner = node.get("owner_profile_id") or owner
            if not current_owner and path.name == "series.json" and location.count(".") == 1:
                current_owner = (owner_overrides or {}).get(location.split(".", 1)[1])
            # ImageVariant, VideoVariant, and StoryboardReference records are
            # the only URL-bearing objects migrated here.
            is_material = (
                isinstance(node.get("url"), str)
                and isinstance(node.get("id"), str)
                and (
                    parent_key in {"variants", "image_variants", "video_variants", "references"}
                    or "prompt_used" in node
                    or "kind" in node and parent_key == "references"
                )
            )
            if is_material:
                key = node.get("storage_key") or storage_key(node.get("url"), output_root)
                if not key:
                    report["rejected"].append({"location": location, "reason": "unresolvable_url"})
                elif not current_owner:
                    report["rejected"].append({"location": location, "reason": "missing_owner"})
                else:
                    media_id = node.get("media_id")
                    if media_id and get_media(current_owner, media_id):
                        pass
                    elif not apply:
                        report["pending"] += 1
                    else:
                        media_id = register_media(
                            current_owner,
                            key,
                            kind="storyboard_reference" if parent_key == "references" else "asset_variant",
                            display_name=node.get("label") or node.get("name") or node.get("id", "material"),
                            metadata={"source_location": location, "variant_id": node.get("id")},
                        )
                        node["media_id"] = media_id
                        report["registered"] += 1
                    node["storage_key"] = key
                    node["url"] = key
                    report["migrated"] += 1
            if "video_url" in node and node.get("video_url") and not node.get("video_media_id"):
                key = storage_key(node.get("video_url"), output_root)
                if key and current_owner:
                    if apply:
                        node["video_media_id"] = register_media(
                            current_owner, key, kind="generated_video",
                            display_name=node.get("id", "video"),
                            metadata={"source_location": location},
                        )
                        report["registered"] += 1
                        report["migrated"] += 1
                    else:
                        report["pending"] += 1
                elif node.get("video_url"):
                    report["rejected"].append({"location": location + ".video_url", "reason": "unresolvable_url"})
            for key, value in list(node.items()):
                walk(value, current_owner, f"{location}.{key}", key)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, owner, f"{location}[{index}]", parent_key)

    walk(data, None, path.name)
    if apply and report["rejected"]:
        return
    if apply and data != original:
        backup = path.with_name(path.name + f".before-media-{int(time.time())}")
        shutil.copy2(path, backup)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("output"))
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.check_only == args.apply:
        parser.error("choose exactly one of --check-only or --apply")
    root = args.root.resolve()
    os.chdir(root.parent)
    report = {"registered": 0, "migrated": 0, "pending": 0, "rejected": []}
    owner_overrides: dict[str, str] = {}
    projects_path = root / "projects.json"
    if projects_path.exists():
        projects = json.loads(projects_path.read_text())
        for project in projects.values() if isinstance(projects, dict) else []:
            if project.get("series_id") and project.get("owner_profile_id"):
                owner_overrides.setdefault(project["series_id"], project["owner_profile_id"])
    for name in STORE_NAMES:
        migrate_store(root / name, root, args.apply, report, owner_overrides)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["rejected"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
