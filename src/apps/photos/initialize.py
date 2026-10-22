"""Explicitly initialize or upgrade a local Demo DB; HTTP never runs this."""

import argparse
from pathlib import Path

from .date_store import DateStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="Absolute SQLite path; parent must exist")
    args = parser.parse_args()
    if not args.database.is_absolute():
        parser.error("Use an absolute path outside public static/output directories")
    DateStore(args.database)
    print("Local photo Demo database initialized (no photos or consent preloaded).")


if __name__ == "__main__":
    main()
