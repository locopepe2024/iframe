from fastapi.testclient import TestClient

from src.apps.comic_gen import api
from src.apps.identity import API_KEY_IDENTITY_HEADER, UserContext
from src.apps.studio_access import require_studio_user


def test_studio_owner_middleware_forwards_api_key_identity(monkeypatch):
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
