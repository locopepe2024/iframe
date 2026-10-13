from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from src.apps.comic_gen.api import get_owned_studio_media, get_provider_media
from src.apps.identity import UserContext
from src.apps.studio_access import require_studio_user, signed_provider_media_url, studio_owner_key


def test_legacy_owner_asset_gets_local_preview_and_rejects_other_owner(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    owner = UserContext(user_id="user-a", owner_profile_id="profile-a", display_name="a", access_token="")
    owner_key = studio_owner_key(owner.owner_profile_id)
    source = Path("output/users") / owner_key / "studio/uploads/cover.png"
    source.parent.mkdir(parents=True)
    Image.new("RGB", (800, 600), "red").save(source)

    app = FastAPI()
    app.add_api_route("/studio/owned-media/{owner_key}/{relative_path:path}", get_owned_studio_media)
    app.dependency_overrides[require_studio_user] = lambda: owner
    with TestClient(app) as client:
        url = f"/studio/owned-media/{owner_key}/uploads/cover.png"
        original = client.get(url)
        preview = client.get(url + "?preview=320")
        foreign = client.get("/studio/owned-media/000000000000000000000000/uploads/cover.png")
        traversal = client.get(f"/studio/owned-media/{owner_key}/%2E%2E/media-registry.sqlite3")

    assert original.status_code == 200
    assert original.headers["cache-control"] == "private, no-store"
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("image/webp")
    assert foreign.status_code == 404
    assert traversal.status_code == 404


def test_provider_media_requires_valid_owner_scoped_signature(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("UNIART_MEDIA_BASE_URL", "https://iframe.example")
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-signing-key")
    owner_key = studio_owner_key("profile-a")
    source = Path("output/users") / owner_key / "studio/uploads/reference.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"reference")

    signed = signed_provider_media_url(str(source))
    parsed = urlsplit(signed)
    app = FastAPI()
    app.add_api_route("/provider/media/{owner_key}/{relative_path:path}", get_provider_media)
    with TestClient(app) as client:
        valid = client.get(parsed.path + "?" + parsed.query)
        invalid = client.get(parsed.path + "?expires=1&signature=invalid")
        other_owner = client.get(parsed.path.replace(owner_key, studio_owner_key("profile-b")) + "?" + parsed.query)

    assert valid.status_code == 200
    assert valid.content == b"reference"
    assert invalid.status_code == 401
    assert other_owner.status_code == 404
