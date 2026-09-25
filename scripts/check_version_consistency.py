#!/usr/bin/env python3
"""Fail when application-version surfaces drift from ``VERSION``."""

from __future__ import annotations

import sys

from versioning import collect_mismatches, read_version


def main() -> int:
    try:
        version = read_version()
        mismatches = collect_mismatches(version=version)
    except (OSError, ValueError) as exc:
        print(f"version check failed: {exc}", file=sys.stderr)
        return 1

    if mismatches:
        print(f"Application version is {version}, but surfaces drift:", file=sys.stderr)
        for mismatch in mismatches:
            print(f"- {mismatch}", file=sys.stderr)
        return 1

    print(f"iFrame application version is consistent: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
