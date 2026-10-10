import hashlib
import io

import pytest

from src.apps.knowledge import blob_store


def test_local_blob_store_detects_corruption(monkeypatch, tmp_path):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_BACKEND", "local")
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_ROOT", str(tmp_path))
    key, digest = blob_store.put("media", b"test-image")
    assert key == "media/" + digest
    assert blob_store.get(key) == b"test-image"
    (tmp_path / key).write_bytes(b"corrupted")
    with pytest.raises(RuntimeError, match="digest mismatch"):
        blob_store.get(key)
    with pytest.raises(ValueError, match="Invalid knowledge blob key"):
        blob_store.get("../../secret")


def test_cos_blob_store_uses_private_content_addressed_key(monkeypatch):
    content = b"short-video"
    calls = []

    class Body:
        def get_raw_stream(self):
            return io.BytesIO(content)

    class Client:
        def put_object(self, **kwargs):
            calls.append(kwargs)

        def get_object(self, **kwargs):
            calls.append(kwargs)
            return {"Body": Body()}

    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_BACKEND", "cos")
    monkeypatch.setattr(blob_store, "_cos_client", lambda: (Client(), "private-knowledge-bucket"))
    key, digest = blob_store.put("media", content)
    assert digest == hashlib.sha256(content).hexdigest()
    assert blob_store.get(key) == content
    assert calls[0] == {
        "Bucket": "private-knowledge-bucket", "Key": f"knowledge/{key}",
        "Body": content, "ContentType": "application/octet-stream",
    }
    assert calls[1] == {"Bucket": "private-knowledge-bucket", "Key": f"knowledge/{key}"}


def test_cos_blob_store_fails_closed_without_configuration(monkeypatch):
    monkeypatch.setenv("IFRAME_KNOWLEDGE_BLOB_BACKEND", "cos")
    for name in (
        "IFRAME_KNOWLEDGE_COS_REGION", "IFRAME_KNOWLEDGE_COS_BUCKET",
        "IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE", "IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE",
    ):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match="not configured"):
        blob_store.put("raw", b"private source")
