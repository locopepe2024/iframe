"""Private content-addressed storage for bounded Agent-submitted knowledge bytes."""

import hashlib
import os
from pathlib import Path
import re
import tempfile


_KEY = re.compile(r"^(raw|media)/[0-9a-f]{64}$")


def _root() -> Path:
    value = os.getenv("IFRAME_KNOWLEDGE_BLOB_ROOT")
    if not value:
        raise RuntimeError("Knowledge blob storage is not configured")
    root = Path(value).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def put(kind: str, content: bytes) -> tuple[str, str]:
    if kind not in ("raw", "media"):
        raise ValueError("Unsupported knowledge blob kind")
    digest = hashlib.sha256(content).hexdigest()
    key = f"{kind}/{digest}"
    target = _root() / key
    target.parent.mkdir(mode=0o700, exist_ok=True)
    if not target.exists():
        fd, staging = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(staging, 0o600)
            os.replace(staging, target)
        finally:
            if os.path.exists(staging):
                os.unlink(staging)
    return key, digest


def get(key: str) -> bytes:
    if not _KEY.fullmatch(key):
        raise ValueError("Invalid knowledge blob key")
    return (_root() / key).read_bytes()
