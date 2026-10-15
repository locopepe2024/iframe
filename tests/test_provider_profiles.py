import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps import user_config
from src.apps.user_config import UserConfigStore, UserConfigUpdate


@pytest.fixture
def owner():
    return UserContext("user", "browser-existing-workspace", "", "")


@pytest.fixture
def store(tmp_path):
    return UserConfigStore(str(tmp_path / "users.db"), master_key="test-master")


def test_profiles_are_independent_encrypted_and_do_not_change_legacy_owner(store, owner):
    store.update(owner, UserConfigUpdate(UNIART_API_KEY="legacy-key"))
    for provider in ("uniart", "nsfw"):
        public = store.update_provider_profile(owner, provider,
            api_key=f"{provider}-private-test-key", base_url=f"https://{provider}.example.test/v1")
        assert public["configured"] is True
        assert "private-test-key" not in json.dumps(public)
    assert store.get_runtime_provider(owner, "uniart")["api_key"] == "uniart-private-test-key"
    assert store.get_runtime_provider(owner, "nsfw")["api_key"] == "nsfw-private-test-key"
    assert store.get_runtime_uniart(owner)["api_key"] == "uniart-private-test-key"
    other = UserContext("other", "other", "", "")
    assert store.get_provider_profile(other, "nsfw")["configured"] is False
    with pytest.raises(HTTPException) as error:
        store.get_runtime_provider(other, "nsfw")
    assert error.value.status_code == 409
    with store._connect() as db:
        rows = db.execute("SELECT * FROM provider_configs").fetchall()
    assert all(row["owner_profile_id"] == owner.owner_profile_id for row in rows)
    assert "private-test-key" not in json.dumps([dict(row) for row in rows])


def test_profile_key_rotation_omission_and_clear_never_use_other_key(store, owner):
    store.update(owner, UserConfigUpdate(UNIART_API_KEY="legacy-key"))
    store.update_provider_profile(owner, "nsfw", api_key="first", base_url="https://nsfw.example.test/v1")
    store.update_provider_profile(owner, "nsfw", base_url="https://second.example.test/v1")
    assert store.get_runtime_provider(owner, "nsfw")["api_key"] == "first"
    store.update_provider_profile(owner, "nsfw", api_key="rotated")
    assert store.get_runtime_provider(owner, "nsfw")["api_key"] == "rotated"
    public = store.update_provider_profile(owner, "nsfw", api_key="")
    assert public["configured"] is False
    with pytest.raises(HTTPException) as error:
        store.get_runtime_nsfw(owner)
    assert error.value.status_code == 409
    assert store.get_runtime_uniart(owner)["api_key"] == "legacy-key"


@pytest.mark.parametrize("base", ["", "ftp://example.test/v1", "https://user:pass@example.test/v1", "https://@example.test/v1", "https://example.test/v1?token=private", "https://example.test/v1#fragment", "https://exam ple.test/v1", "https://example.test:bad/v1", "https://example.test/api"])
def test_invalid_nsfw_endpoint_cannot_replace_profile(store, owner, base):
    store.update_provider_profile(owner, "nsfw", api_key="key", base_url="https://valid.example.test/v1")
    with pytest.raises(HTTPException) as error:
        store.update_provider_profile(owner, "nsfw", base_url=base)
    assert error.value.status_code == 422
    assert store.get_runtime_provider(owner, "nsfw")["base_url"] == "https://valid.example.test/v1"


def test_legacy_nsfw_compatibility_is_visible_and_explicit_catalog_is_strict(store, owner, monkeypatch):
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "https://legacy.example.test/v1")
    store.update(owner, UserConfigUpdate(UNIART_API_KEY="legacy-key"))
    assert store.get_provider_profile(owner, "nsfw")["source"] == "legacy"
    assert store.get_runtime_nsfw(owner)["api_key"] == "legacy-key"
    with pytest.raises(HTTPException) as error:
        store.get_runtime_provider(owner, "nsfw")
    assert error.value.status_code == 409


def test_provider_api_preserves_identity_and_never_sets_owner_cookie(store, owner, monkeypatch):
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    app = FastAPI()
    app.include_router(user_config.router)
    app.dependency_overrides[require_user_context] = lambda: owner
    with TestClient(app) as client:
        response = client.put("/user/providers/nsfw", json={"api_key": "private-key", "base_url": "https://nsfw.example.test/v1"})
        assert response.status_code == 200
        assert "set-cookie" not in response.headers
        assert "private-key" not in response.text
        assert client.get("/user/providers/nsfw").json()["configured"] is True
        assert client.get("/user/providers/unknown").status_code == 422


def test_nsfw_adapter_uses_profile_endpoint_even_when_deployment_default_differs(store, owner, monkeypatch):
    from src.models.nsfw_new_one import gateway_config
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "https://legacy.example.test/v1")
    store.update_provider_profile(owner, "nsfw", api_key="nsfw-key", base_url="https://profile.example.test/v1")
    config = gateway_config(store.get_runtime_nsfw(owner))
    assert config == {"api_key": "nsfw-key", "base_url": "https://profile.example.test/v1"}


def test_explicit_uniart_clear_updates_readiness_without_legacy_fallback(store, owner):
    store.update(owner, UserConfigUpdate(UNIART_API_KEY="legacy-key"))
    store.update_provider_profile(owner, "uniart", api_key="", base_url="https://uniart.example.test/v1")
    assert store.get_public(owner)["runtime_uniart_available"] is False
    with pytest.raises(HTTPException) as error:
        store.get_runtime_uniart(owner)
    assert error.value.status_code == 409


def test_studio_nsfw_context_uses_current_owners_profile(store, owner, monkeypatch):
    from src.apps.studio_access import set_studio_user, reset_studio_user, studio_nsfw_new_one_config
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    store.update_provider_profile(owner, "nsfw", api_key="nsfw-key", base_url="https://nsfw.example.test/v1")
    token = set_studio_user(owner)
    try:
        assert studio_nsfw_new_one_config()["api_key"] == "nsfw-key"
    finally:
        reset_studio_user(token)


@pytest.mark.parametrize("kind", ["image", "video"])
def test_playground_nsfw_uses_matching_loader_without_loading_uniart(kind, tmp_path, monkeypatch):
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.models import PlaygroundGeneration, PlaygroundMode
    from unittest.mock import Mock
    captured = []
    config = {"provider": "nsfw", "api_key": "nsfw-key", "base_url": "https://nsfw.example.test/v1"}
    adapter = SimpleNamespace(generate=lambda *a, **kw: (None, 0))
    name = "NSFWNewOneImageModel" if kind == "image" else "NSFWNewOneVideoModel"
    monkeypatch.setattr(f"src.models.nsfw_new_one.{name}", lambda resolved: (captured.append(resolved) or adapter))
    service = PlaygroundService(Mock(), provider_config_loader=lambda: pytest.fail("UniArt credentials requested"),
                                nsfw_config_loader=lambda: config)
    generation = PlaygroundGeneration(id="test", mode=PlaygroundMode.T2I if kind == "image" else PlaygroundMode.T2V,
        model_id="nsfw/seedream_5.0Pro_nsfw" if kind == "image" else "nsfw/wan3.0", prompt="test", created_at="2026-10-15",
        parameters={"duration": 4, "resolution": "480p"})
    if kind == "image":
        service._generate_image_mulerouter(generation, str(tmp_path / "image.jpg"), 0)
    else:
        service._generate_video_nsfw(generation, str(tmp_path / "video.mp4"))
    assert captured == [config]
