"""Toggle outbound LLM request capture without restarting the backend."""

import argparse
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("enable", "disable", "status"))
    args = parser.parse_args()
    directory = Path(os.getenv("LUMENX_OUTPUT_DIR", "/srv/lumenx/output")) / "diagnostics"
    marker = directory / "llm-request-debug.enabled"
    if args.action == "enable":
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600) if not marker.exists() else None
        if fd is not None:
            os.close(fd)
    elif args.action == "disable":
        marker.unlink(missing_ok=True)
    print("enabled" if marker.is_file() else "disabled")


if __name__ == "__main__":
    main()
