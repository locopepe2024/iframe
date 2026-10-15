import json
from io import BytesIO

import pytest

from src.utils import provider_catalog


@pytest.mark.parametrize("provider", ["uniart", "nsfw"])
def test_explicit_catalog_uses_matching_profile_and_allowlist(provider, monkeypatch):
    calls = []
    payload = {"data": [{"id": "wan3.0"}, {"id": "chat-model"}]}
    def open_request(request, timeout):
        calls.append((request.full_url, request.get_header("Authorization")))
        return BytesIO(json.dumps(payload).encode())
    monkeypatch.setattr(provider_catalog, "urlopen", open_request)
    other = "NSFW" if provider == "uniart" else "UNIART"
    monkeypatch.setenv(f"{other}_MODEL_ALLOWLIST", "unrelated-model")
    monkeypatch.setenv(f"{provider.upper()}_MODEL_ALLOWLIST", "wan3.0")
    config = {"provider": provider, "api_key": "private-key", "base_url": f"https://{provider}.example.test/v1"}
    models = provider_catalog.fetch_provider_catalog(provider, config)
    assert [model["id"] for model in models] == [f"{provider}/wan3.0"]
    assert models[0]["provider"] == provider
    assert calls == [(f"https://{provider}.example.test/v1/models", "Bearer private-key")]
    assert "private-key" not in json.dumps(models)


def test_catalog_rejects_mismatched_profile_before_network(monkeypatch):
    monkeypatch.setattr(provider_catalog, "urlopen", lambda *a, **kw: pytest.fail("network called"))
    with pytest.raises(ValueError, match="does not match"):
        provider_catalog.fetch_provider_catalog("nsfw", {"provider": "uniart"})


def test_explicit_endpoint_uses_current_owner_profile_and_redacts_upstream_errors(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps import user_config
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user
    from fastapi import HTTPException
    store = user_config.UserConfigStore(str(tmp_path / "users.db"))
    owner = UserContext("user", "owner", "", "")
    store.update_provider_profile(owner, "nsfw", api_key="private-key", base_url="https://nsfw.example.test/v1")
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    def fetch(provider, config):
        assert provider == "nsfw" and config["api_key"] == "private-key"
        return [{"id": "nsfw/chat-model"}]
    monkeypatch.setattr(provider_catalog, "fetch_provider_catalog", fetch)
    token = set_studio_user(owner)
    try:
        result = api.get_uniart_models(provider="nsfw")
        assert result["provider"] == "nsfw"
        assert result["models"] == [{"id": "nsfw/chat-model"}]
        monkeypatch.setattr(provider_catalog, "fetch_provider_catalog", lambda *a: (_ for _ in ()).throw(RuntimeError("private-key")))
        with pytest.raises(HTTPException) as error:
            api.get_uniart_models(provider="nsfw")
        assert error.value.status_code == 502
        assert "private-key" not in error.value.detail
    finally:
        reset_studio_user(token)
