from types import SimpleNamespace
import sys

from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.apps.identity import UserContext
from src.apps.studio_access import reset_studio_user, set_studio_user


def test_openai_adapter_uses_request_owner_uniart_config_without_cross_user_cache(monkeypatch):
    calls = []

    class Client:
        def __init__(self, api_key, base_url):
            calls.append((api_key, base_url))
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=api_key))]
            )))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "stale-shared-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://stale.example/v1")

    configs = {
        "profile-a": {"api_key": "key-a", "base_url": "https://a.example/v1"},
        "profile-b": {"api_key": "key-b", "base_url": "https://b.example/v1"},
    }
    monkeypatch.setattr(
        "src.apps.studio_access.runtime_uniart_for_owner",
        lambda user_id, profile_id: configs[profile_id],
    )
    adapter = LLMAdapter()

    token_a = set_studio_user(UserContext("user-a", "profile-a", "A", ""))
    try:
        assert adapter.chat([{"role": "user", "content": "A"}], model="gpt-5.6-sol") == "key-a"
    finally:
        reset_studio_user(token_a)

    token_b = set_studio_user(UserContext("user-b", "profile-b", "B", ""))
    try:
        assert adapter.chat([{"role": "user", "content": "B"}], model="gpt-5.6-sol") == "key-b"
    finally:
        reset_studio_user(token_b)

    assert calls == [
        ("key-a", "https://a.example/v1"),
        ("key-b", "https://b.example/v1"),
    ]


def test_openai_adapter_keeps_environment_fallback_without_studio_user(monkeypatch):
    captured = {}

    class Client:
        def __init__(self, api_key, base_url):
            captured.update(api_key=api_key, base_url=base_url)

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "desktop-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://desktop.example/v1")

    adapter = LLMAdapter()
    assert adapter._get_client() is adapter._get_client()
    assert captured == {"api_key": "desktop-key", "base_url": "https://desktop.example/v1"}
