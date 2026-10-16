"""Revision-keyed WebP covers for private Tencent COS media."""

import hashlib
import os
import tempfile
from pathlib import Path

from .media_thumbnails import (
    MAX_PREVIEW_SOURCE_BYTES,
    MAX_VIDEO_PREVIEW_SOURCE_BYTES,
    PREVIEW_MAX_EDGES,
    VIDEO_DEMUXERS,
    create_media_thumbnail,
)


def create_cos_media_preview(uploader, object_key: str, owner_root: str, max_edge: int) -> str:
    """Download one verified COS object revision into an owner-scoped WebP cache."""
    if max_edge not in PREVIEW_MAX_EDGES:
        raise ValueError("Unsupported media preview size")
    if not uploader.is_configured:
        raise OSError("COS is unavailable")
    suffix = Path(object_key).suffix.lower()
    if suffix not in VIDEO_DEMUXERS and suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
        raise ValueError("Unsupported media preview format")

    root = Path(owner_root).resolve()
    cache_dir = root / ".cos-previews"
    cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not cache_dir.resolve().is_relative_to(root):
        raise ValueError("COS preview cache is outside its owner directory")

    head = uploader.client.head_object(Bucket=uploader.bucket_name, Key=object_key)
    etag = head.get("ETag") or head.get("etag")
    size = int(head.get("Content-Length", head.get("content-length", -1)))
    limit = MAX_VIDEO_PREVIEW_SOURCE_BYTES if suffix in VIDEO_DEMUXERS else MAX_PREVIEW_SOURCE_BYTES
    if not etag or size <= 0 or size > limit:
        raise ValueError("COS media has no usable revision or exceeds preview limits")

    revision = f"{object_key}:{etag}:{size}:{head.get('Last-Modified', head.get('last-modified', ''))}:{max_edge}"
    destination = cache_dir / f"{hashlib.sha256(revision.encode()).hexdigest()}.webp"
    if destination.is_symlink():
        raise ValueError("COS preview cache contains a symlink")
    if destination.is_file():
        return str(destination)

    source_path = None
    generated = None
    try:
        descriptor, source_path = tempfile.mkstemp(prefix=".source-", suffix=suffix, dir=cache_dir)
        with os.fdopen(descriptor, "wb") as output:
            body = uploader.client.get_object(Bucket=uploader.bucket_name, Key=object_key, IfMatch=etag)["Body"]
            written = 0
            try:
                for chunk in body.get_stream(chunk_size=1024 * 1024):
                    written += len(chunk)
                    if written > size or written > limit:
                        raise ValueError("COS media changed or exceeds preview limits")
                    output.write(chunk)
            finally:
                body.get_raw_stream().close()
        if written != size:
            raise ValueError("COS media download was incomplete")
        generated = create_media_thumbnail(source_path, str(root), max_edge)
        os.replace(generated, destination)
        generated = None
        return str(destination)
    finally:
        if source_path and os.path.exists(source_path):
            os.unlink(source_path)
        if generated and os.path.exists(generated):
            os.unlink(generated)
