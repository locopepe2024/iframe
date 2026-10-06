"""Bounded, owner-scoped WebP previews for asset-library cover variants."""

import hashlib
import os
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from .media_thumbnails import create_media_thumbnail


MAX_SOURCE_BYTES = 25 * 1024 * 1024


def create_asset_preview(source: str, owner_root: str, version: str, *, remote: bool = False) -> str:
    """Cache a 320px preview; remote must be a server-signed storage URL."""
    root = Path(owner_root).resolve()
    cache_dir = root / ".asset-previews"
    cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    local_version = "" if remote else f":{os.stat(source).st_size}:{os.stat(source).st_mtime_ns}"
    key = hashlib.sha256(f"{source if not remote else version}:{version}{local_version}".encode()).hexdigest()
    destination = cache_dir / f"{key}.webp"
    if destination.is_file():
        return str(destination)

    source_file = None
    generated = None
    try:
        fd, source_file = tempfile.mkstemp(prefix="source-", dir=cache_dir)
        with os.fdopen(fd, "wb") as output:
            if remote:
                with urlopen(Request(source, headers={"User-Agent": "iFrame-Studio/1.0"}), timeout=20) as response:
                    while chunk := response.read(1024 * 1024):
                        if output.tell() + len(chunk) > MAX_SOURCE_BYTES:
                            raise ValueError("Asset preview source exceeds 25 MiB")
                        output.write(chunk)
            else:
                with open(source, "rb") as input_file:
                    while chunk := input_file.read(1024 * 1024):
                        if output.tell() + len(chunk) > MAX_SOURCE_BYTES:
                            raise ValueError("Asset preview source exceeds 25 MiB")
                        output.write(chunk)
        generated = create_media_thumbnail(source_file, str(root), 320)
        os.replace(generated, destination)
        generated = None
        return str(destination)
    finally:
        if source_file and os.path.exists(source_file):
            os.unlink(source_file)
        if generated and os.path.exists(generated):
            os.unlink(generated)
