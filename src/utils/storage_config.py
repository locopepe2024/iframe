"""Validated process-level local media root and storage backend settings."""

import os
from pathlib import Path

SUPPORTED_STORAGE_BACKENDS = frozenset({"local", "cos", "oss"})


def media_root() -> str:
    value = (os.getenv("IFRAME_MEDIA_ROOT") or "output").strip()
    if not value:
        raise ValueError("IFRAME_MEDIA_ROOT must not be empty")
    return str(Path(value).expanduser())


def storage_backend() -> str:
    value = (os.getenv("IFRAME_STORAGE_BACKEND") or "local").strip().lower()
    if value not in SUPPORTED_STORAGE_BACKENDS:
        raise ValueError("IFRAME_STORAGE_BACKEND must be one of: local, cos, oss")
    return value
