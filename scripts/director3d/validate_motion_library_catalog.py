"""Validate the auditable catalog for Blender motion-library intake."""

import argparse
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


FORMATS = {"bvh", "fbx", "glb"}
LICENSE_STATES = {"verified", "needs_verification", "restricted"}
RETARGET_STATES = {"unmapped", "mapped", "validated"}


def positive_number(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


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
        if isinstance(motion_id, str):
            seen.add(motion_id)
        if entry.get("format") not in FORMATS:
            errors.append(f"{prefix}.format must be one of {sorted(FORMATS)}")
        if entry.get("licenseStatus") not in LICENSE_STATES:
            errors.append(f"{prefix}.licenseStatus is invalid")
        if entry.get("retargetStatus") not in RETARGET_STATES:
            errors.append(f"{prefix}.retargetStatus is invalid")
        if not positive_number(entry.get("fps")):
            errors.append(f"{prefix}.fps must be positive")
        availability = entry.get("availability", "intake")
        if availability not in ("intake", "ready"):
            errors.append(f"{prefix}.availability must be intake or ready")
        locomotion = entry.get("locomotion")
        if locomotion is not None or availability == "ready":
            if not isinstance(locomotion, dict):
                errors.append(f"{prefix}.locomotion must be an object")
            else:
                if locomotion.get("mode") not in ("in_place", "root_motion"):
                    errors.append(f"{prefix}.locomotion.mode is invalid")
                for key in ("nominalSpeedMps", "cycleSeconds"):
                    if not positive_number(locomotion.get(key)):
                        errors.append(f"{prefix}.locomotion.{key} must be finite and positive")
        if availability == "ready":
            if entry.get("licenseStatus") != "verified" or entry.get("retargetStatus") != "validated":
                errors.append(f"{prefix}.ready requires verified license and validated retarget")
            for key in ("fileSha256", "targetRigSha256"):
                if not sha256(entry.get(key)):
                    errors.append(f"{prefix}.{key} must be a SHA-256")
            contact = entry.get("contactValidation")
            if not isinstance(contact, dict) or contact.get("status") != "passed" or not sha256(contact.get("reportSha256")):
                errors.append(f"{prefix}.ready requires a hashed passed contact report")
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
