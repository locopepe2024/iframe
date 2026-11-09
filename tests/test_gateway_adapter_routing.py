"""Gateway selection must preserve credential/endpoint and protocol boundaries."""
from types import SimpleNamespace
import sys

import pytest
from fastapi import HTTPException

from src.apps.identity import UserContext
from src.apps.studio_access import reset_studio_user, set_studio_user
from src.apps.user_config import UserConfigStore, UserConfigUpdate
from src.models.nsfw_new_one import gateway_config


@pytest.mark.parametrize("label", ["provider", "catalog_name"])
def test_greena_uses_saved_endpoint_instead_of_deployment_default(monkeypatch, label):
    monkeypatch.setenv("GREENA_BASE_URL", "https://deployment.example/v1")
    assert gateway_config({label: "greena", "api_key": "owner-key", "base_url": "https://owner.example/v1"}) == {
        "api_key": "owner-key", "base_url": "https://owner.example/v1",
    }


@pytest.mark.parametrize("label", ["provider", "catalog_name"])
def test_greena_rejects_uniart_credentials_before_network(monkeypatch, label):
    monkeypatch.setenv("GREENA_BASE_URL", "https://greena.example/v1")
    with pytest.raises(ValueError, match="provider"):
        gateway_config({label: "uniart", "api_key": "uniart-key", "base_url": "https://uniart.example/v1"})


@pytest.mark.parametrize("kind", ["image", "video"])
def test_uniart_rejects_greena_credentials_before_network(kind):
    from src.models.uniart import UniArtImageModel, UniArtVideoModel
    adapter = UniArtImageModel if kind == "image" else UniArtVideoModel
    with pytest.raises(ValueError, match="provider"):
        adapter({"catalog_name": "greena", "api_key": "greena-key", "base_url": "https://greena.example/v1"})


def test_selected_uniart_key_cannot_be_borrowed_by_greena(tmp_path):
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    store.update(owner, UserConfigUpdate(catalog_name="uniart", UNIART_API_KEY="uniart-only",
                                        UNIART_BASE_URL="https://uniart.example/v1"))
    with pytest.raises(HTTPException) as error:
        store.get_runtime_nsfw(owner)
    assert error.value.status_code == 409


@pytest.mark.parametrize("prefix,provider", [("nsfw", "greena"), ("greena", "greena"), ("uniart", "uniart")])
def test_llm_namespace_selects_own_profile_and_sends_raw_model(monkeypatch, tmp_path, prefix, provider):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    # Select the OTHER gateway, so accidentally using the active key is observable.
    other = "uniart" if provider == "greena" else "greena"
    store.update(owner, UserConfigUpdate(catalog_name=other, UNIART_API_KEY="wrong-key",
                                        UNIART_BASE_URL="https://wrong.example/v1"))
    store.update_provider_profile(owner, provider, api_key="right-key", base_url="https://right.example/v1")
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("GREENA_BASE_URL", "https://deployment.example/v1")
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    adapter = LLMAdapter(default_model=f"{prefix}/shared-model")
    token = set_studio_user(owner)
    try:
        assert adapter.is_configured
        assert adapter.chat([{"role": "user", "content": "write"}]) == "ok"
    finally:
        reset_studio_user(token)
    assert captured["api_key"] == "right-key"
    assert captured["base_url"] == "https://right.example/v1"
    assert captured["model"] == "shared-model"


@pytest.mark.parametrize("selected,requested", [("uniart", "greena"), ("greena", "uniart")])
def test_missing_model_profile_never_falls_back_to_other_gateway(monkeypatch, tmp_path, selected, requested):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    owner = UserContext("user", "owner", "", "")
    store = UserConfigStore(str(tmp_path / "users.db"))
    store.update(owner, UserConfigUpdate(catalog_name=selected, UNIART_API_KEY="other-key",
                                        UNIART_BASE_URL="https://other.example/v1"))
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("OPENAI_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(
        OpenAI=lambda **_: pytest.fail("No client may be created for missing profile")))
    adapter = LLMAdapter(default_model=f"{requested}/shared-model")
    token = set_studio_user(owner)
    try:
        assert not adapter.is_configured
        with pytest.raises(HTTPException) as error:
            adapter.chat([{"role": "user", "content": "write"}])
        assert error.value.status_code == 409
    finally:
        reset_studio_user(token)


def test_llm_reloads_saved_gateway_after_owner_and_settings_switch(monkeypatch, tmp_path):
    from src.apps.comic_gen.llm_adapter import LLMAdapter
    from src.apps import user_config
    store = UserConfigStore(str(tmp_path / "users.db"))
    monkeypatch.setattr(user_config, "get_user_config_store", lambda: store)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    calls = []

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: (
                calls.append((api_key, base_url, kwargs["model"])) or
                SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
            )))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    adapter = LLMAdapter()
    for user_id, provider, key in [("a", "greena", "a-green"), ("b", "uniart", "b-uni"), ("a", "greena", "a-rotated")]:
        owner = UserContext(user_id, f"owner-{user_id}", "", "")
        store.update(owner, UserConfigUpdate(catalog_name=provider, UNIART_API_KEY=key,
                                            UNIART_BASE_URL=f"https://{key}.example/v1"))
        token = set_studio_user(owner)
        try:
            assert adapter.chat([{"role": "user", "content": "write"}], model=f"{provider}/shared-model") == "ok"
        finally:
            reset_studio_user(token)
    assert calls == [(key, f"https://{key}.example/v1", "shared-model") for key in ("a-green", "b-uni", "a-rotated")]
