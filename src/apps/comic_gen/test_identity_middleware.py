from fastapi.testclient import TestClient
from PIL import Image

from src.apps.comic_gen import api
from src.apps.identity import API_KEY_IDENTITY_HEADER, UserContext
from src.apps.studio_access import require_studio_user, studio_media_url, studio_owner_key


def test_studio_owner_middleware_forwards_api_key_identity(monkeypatch, tmp_path):
    identity = "a" * 64
    user = UserContext(
        user_id=f"apikey-{identity}",
        owner_profile_id=f"apikey-{identity}",
        display_name="API key workspace",
        access_token="",
    )
    received: list[tuple[str | None, str | None, str | None]] = []

    def resolve(authorization, browser_profile, api_key_identity):
        received.append((authorization, browser_profile, api_key_identity))
        return user, False

    class EmptyPipeline:
        scripts = {}
        series_store = {}
        output_root = str(tmp_path)

        @staticmethod
        def migrate_legacy_browser_owners(owner_user_id, owner_profile_id):
            assert owner_user_id == user.user_id
            assert owner_profile_id == user.owner_profile_id

        @staticmethod
        def list_scripts(owner_profile_id):
            assert owner_profile_id == user.owner_profile_id
            return []

    monkeypatch.setattr(api, "_resolve_request_context", resolve)
    monkeypatch.setattr(api, "pipeline", EmptyPipeline())
    api.app.dependency_overrides[require_studio_user] = lambda: user
    try:
        with TestClient(api.app) as client:
            response = client.get(
                "/projects/",
                headers={API_KEY_IDENTITY_HEADER: identity},
            )
        assert response.status_code == 200
        assert received == [(None, None, identity)]
    finally:
        api.app.dependency_overrides.pop(require_studio_user, None)


def test_studio_media_delivery_routes_receive_owner_context(monkeypatch, tmp_path):
    identity = "b" * 64
    user = UserContext(
        user_id=f"apikey-{identity}",
        owner_profile_id=f"apikey-{identity}",
        display_name="API key workspace",
        access_token="",
    )
    received = []

    def resolve(authorization, browser_profile, api_key_identity):
        received.append(api_key_identity)
        return user, False

    class EmptyPipeline:
        scripts = {}
        series_store = {}
        output_root = str(tmp_path)

        @staticmethod
        def migrate_legacy_browser_owners(owner_user_id, owner_profile_id):
            pass

    monkeypatch.setattr(api, "_resolve_request_context", resolve)
    monkeypatch.setattr(api, "pipeline", EmptyPipeline())
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-signing-key")
    owner_key = studio_owner_key(user.owner_profile_id)
    stored = f"users/{owner_key}/studio/uploads/frame.png"
    source = tmp_path / stored
    source.parent.mkdir(parents=True)
    Image.new("RGB", (32, 24), "blue").save(source)
    signed = studio_media_url(user.owner_profile_id, stored, output_root=str(tmp_path))
    with TestClient(api.app) as client:
        media = client.get(
            "/studio/media-delivery",
            params={"reference": signed, "preview": 320},
            headers={API_KEY_IDENTITY_HEADER: identity},
        )
        record = client.get(
            "/studio/media-records/missing/delivery",
            headers={API_KEY_IDENTITY_HEADER: identity},
        )
        preview = client.get(media.json()["url"]) if media.status_code == 200 else None
    assert media.status_code == 200
    assert preview is not None and preview.status_code == 200
    assert preview.headers["content-type"] == "image/webp"
    assert record.status_code == 404
    assert received == [identity, identity]
