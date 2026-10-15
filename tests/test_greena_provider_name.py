import json
from io import BytesIO

from src.apps.identity import UserContext
from src.apps.user_config import UserConfigStore
from src.models.greena import GreenAImageModel, GreenAVideoModel
from src.models.nsfw_new_one import NSFWNewOneImageModel, NSFWNewOneVideoModel, gateway_config
from src.utils import provider_catalog


def test_greena_and_legacy_name_share_existing_encrypted_profile(tmp_path):
    store = UserConfigStore(str(tmp_path / "users.db"))
    owner = UserContext("user", "owner", "", "")
    store.update_provider_profile(owner, "nsfw", api_key="old-key", base_url="https://gateway.example.test/v1")
    public = store.get_provider_profile(owner, "greena")
    assert public["provider"] == "greena"
    assert public["display_name"] == "GreenA"
    assert store.get_runtime_provider(owner, "greena")["api_key"] == "old-key"
    store.update_provider_profile(owner, "greena", api_key="new-key")
    assert store.get_runtime_provider(owner, "nsfw")["api_key"] == "new-key"
    with store._connect() as db:
        assert db.execute("SELECT count(*) FROM provider_configs").fetchone()[0] == 1


def test_greena_catalog_name_preserves_saved_model_ids_and_prefers_new_filter(monkeypatch):
    monkeypatch.setenv("GREENA_MODEL_ALLOWLIST", "wan3.0")
    monkeypatch.setenv("NSFW_MODEL_ALLOWLIST", "different-model")
    monkeypatch.setattr(provider_catalog, "urlopen", lambda *a, **kw: BytesIO(json.dumps({"data": [{"id": "wan3.0"}, {"id": "other"}]}).encode()))
    models = provider_catalog.fetch_provider_catalog("greena", {
        "provider": "greena", "api_key": "key", "base_url": "https://gateway.example.test/v1"})
    assert [m["id"] for m in models] == ["nsfw/wan3.0"]
    assert models[0]["provider"] == "greena"
    assert "GreenA" in models[0]["description"]


def test_greena_adapter_names_and_legacy_imports_are_identical(monkeypatch):
    assert GreenAImageModel is NSFWNewOneImageModel
    assert GreenAVideoModel is NSFWNewOneVideoModel
    monkeypatch.setenv("GREENA_BASE_URL", "https://greena.example.test/v1")
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "https://legacy.example.test/v1")
    assert gateway_config({"api_key": "key"})["base_url"] == "https://greena.example.test/v1"


def test_greena_profile_api_alias_preserves_identity(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps import user_config
    from src.apps.identity import require_user_context
    store = UserConfigStore(str(tmp_path / "users.db"))
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    app = FastAPI()
    app.include_router(user_config.router)
    owner = UserContext("user", "existing-owner", "", "")
    app.dependency_overrides[require_user_context] = lambda: owner
    with TestClient(app) as client:
        response = client.put("/user/providers/greena", json={"api_key": "key", "base_url": "https://greena.example.test/v1"})
        assert response.status_code == 200
        assert response.json()["display_name"] == "GreenA"
        assert "set-cookie" not in response.headers
        assert client.get("/user/providers/nsfw").json() == response.json()
