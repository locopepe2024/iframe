"""Private content-addressed storage for bounded Agent-submitted knowledge bytes."""

import hashlib
import os
from pathlib import Path
import re
import tempfile


_KEY = re.compile(r"^(raw|media)/[0-9a-f]{64}$")


def _backend() -> str:
    backend = os.getenv("IFRAME_KNOWLEDGE_BLOB_BACKEND", "local")
    if backend not in ("local", "cos"):
        raise RuntimeError("Unsupported knowledge blob backend")
    return backend


def _root() -> Path:
    value = os.getenv("IFRAME_KNOWLEDGE_BLOB_ROOT")
    if not value:
        raise RuntimeError("Knowledge blob storage is not configured")
    root = Path(value).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root


def _cos_client():
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError as exc:
        raise RuntimeError("Knowledge COS SDK is unavailable") from exc

    required = (
        "IFRAME_KNOWLEDGE_COS_REGION",
        "IFRAME_KNOWLEDGE_COS_BUCKET",
        "IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE",
        "IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE",
    )
    if any(not os.getenv(name) for name in required):
        raise RuntimeError("Knowledge COS is not configured")
    secret_id = Path(os.environ["IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE"]).read_text().strip()
    secret_key = Path(os.environ["IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE"]).read_text().strip()
    if not secret_id or not secret_key:
        raise RuntimeError("Knowledge COS credentials are empty")
    config = CosConfig(Region=os.environ["IFRAME_KNOWLEDGE_COS_REGION"],
                       SecretId=secret_id, SecretKey=secret_key, Scheme="https")
    return CosS3Client(config), os.environ["IFRAME_KNOWLEDGE_COS_BUCKET"]


def put(kind: str, content: bytes) -> tuple[str, str]:
    if kind not in ("raw", "media"):
        raise ValueError("Unsupported knowledge blob kind")
    digest = hashlib.sha256(content).hexdigest()
    key = f"{kind}/{digest}"
    if _backend() == "cos":
        client, bucket = _cos_client()
        try:
            client.put_object(Bucket=bucket, Key=f"knowledge/{key}", Body=content,
                              ContentType="application/octet-stream", ACL="private")
        except Exception as exc:
            raise RuntimeError("Knowledge COS write failed") from exc
        return key, digest
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
    if _backend() == "cos":
        client, bucket = _cos_client()
        try:
            content = client.get_object(Bucket=bucket, Key=f"knowledge/{key}")["Body"].get_raw_stream().read()
        except Exception as exc:
            raise RuntimeError("Knowledge COS read failed") from exc
    else:
        content = (_root() / key).read_bytes()
    if hashlib.sha256(content).hexdigest() != key.rsplit("/", 1)[1]:
        raise RuntimeError("Knowledge blob digest mismatch")
    return content
