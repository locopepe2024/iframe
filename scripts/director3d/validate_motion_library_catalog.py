"""Validate the auditable catalog for Blender motion-library intake."""

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse


FORMATS = {"bvh", "fbx", "glb"}
LICENSE_STATES = {"verified", "needs_verification", "restricted"}
RETARGET_STATES = {"unmapped", "mapped", "validated"}


def validate(payload):
    errors = []
    if not isinstance(payload, dict) or payload.get("schema") != "director3d-motion-library.catalog.v1":
        return ["schema must be director3d-motion-library.catalog.v1"]
    entries = payload.get("entries")
    if not isinstance(entries, list) or not entries:
        return ["entries must be a non-empty array"]
    seen = set()
    for index, entry in enumerate(entries):
        prefix = f"entries[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{prefix} must be an object")
            continue
        motion_id = entry.get("motionId")
        if not isinstance(motion_id, str) or not motion_id.strip() or motion_id in seen:
            errors.append(f"{prefix}.motionId must be unique non-empty text")
        seen.add(motion_id)
        if entry.get("format") not in FORMATS:
            errors.append(f"{prefix}.format must be one of {sorted(FORMATS)}")
        if entry.get("licenseStatus") not in LICENSE_STATES:
            errors.append(f"{prefix}.licenseStatus is invalid")
        if entry.get("retargetStatus") not in RETARGET_STATES:
            errors.append(f"{prefix}.retargetStatus is invalid")
        if not isinstance(entry.get("fps"), (int, float)) or entry["fps"] <= 0:
            errors.append(f"{prefix}.fps must be positive")
        source = entry.get("source")
        if not isinstance(source, dict) or source.get("kind") not in {"local", "external"}:
            errors.append(f"{prefix}.source.kind must be local or external")
            continue
        url = source.get("url")
        if url is not None and (source["kind"] != "external" or not isinstance(url, str) or urlparse(url).scheme not in {"http", "https"}):
            errors.append(f"{prefix}.source.url must be an http(s) URL only for external sources")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("catalog", type=Path)
    args = parser.parse_args()
    errors = validate(json.loads(args.catalog.read_text()))
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(json.dumps({"schema": "director3d-motion-library.catalog.v1", "status": "valid"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
