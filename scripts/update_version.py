#!/usr/bin/env python3
"""Update every iFrame application-version surface from one SemVer value."""

from __future__ import annotations

import argparse
import sys

from versioning import collect_mismatches, update_surfaces, validate_version


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="new application version, e.g. 0.1.1")
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate that the tree already uses VERSION instead of writing files",
    )
    args = parser.parse_args()

    try:
        version = validate_version(args.version)
        if args.check:
            mismatches = collect_mismatches(version=version)
            if mismatches:
                for mismatch in mismatches:
                    print(mismatch, file=sys.stderr)
                return 1
            print(f"All application-version surfaces match {version}")
            return 0

        update_surfaces(version)
    except (OSError, ValueError) as exc:
        print(f"version update failed: {exc}", file=sys.stderr)
        return 1

    print(f"Updated iFrame application version to {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
