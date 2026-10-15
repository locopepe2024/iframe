from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from PIL import Image

from src.apps.studio_access import studio_media_url, studio_owner_key, verify_studio_media


def test_resigns_persisted_expired_display_url_without_accepting_tampering(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-key")
    key = studio_owner_key("profile-a")
    stored = f"users/{key}/studio/uploads/a.jpg"
    source = Path("output") / stored
    source.parent.mkdir(parents=True)
    Image.new("RGB", (20, 20), "red").save(source)
    expired = studio_media_url("profile-a", stored, -60)
    refreshed = studio_media_url("profile-a", expired)
    query = parse_qs(urlsplit(refreshed).query)
    assert verify_studio_media(key, "uploads/a.jpg", int(query["expires"][0]), query["signature"][0]) == str(source.resolve())
    tampered = expired.replace("signature=", "signature=invalid")
    assert studio_media_url("profile-a", tampered) == tampered
    assert studio_media_url("other-owner", expired) == expired

def test_expired_signed_get_remains_private_and_invalid_hmac_cannot_be_reused(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.comic_gen.api import get_studio_media
    from src.apps.studio_access import resolve_studio_reference
    import pytest
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-key")
    key = studio_owner_key("profile-a")
    stored = f"users/{key}/studio/uploads/a.jpg"
    source = Path("output") / stored
    source.parent.mkdir(parents=True)
    source.write_bytes(b"original")
    expired = studio_media_url("profile-a", stored, -60)
    app = FastAPI()
    app.add_api_route("/studio/media/{owner_key}/{relative_path:path}", get_studio_media)
    with TestClient(app) as client:
        assert client.get(expired).status_code == 401
        fresh = studio_media_url("profile-a", expired)
        assert client.get(fresh).content == b"original"
        assert client.get(fresh.replace("signature=", "signature=bad")).status_code == 401
    with pytest.raises(ValueError):
        resolve_studio_reference(expired.replace("signature=", "signature=bad"), "profile-a")
    with pytest.raises(ValueError):
        resolve_studio_reference(expired, "other-owner")
