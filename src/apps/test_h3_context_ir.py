import json
from unittest.mock import patch
from types import SimpleNamespace

from src.apps.agent_api import complete_h3_context_ir


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps({"content": {"prompt": "refined prompt"}}).encode()


def test_h3_ir_uses_dedicated_context_ir_endpoint(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode())
        captured["timeout"] = timeout
        return _Response()

    with patch("src.apps.agent_api.urlopen", fake_urlopen), patch(
        "src.apps.agent_api.get_user_config_store",
        return_value=SimpleNamespace(get_runtime_uniart=lambda _ctx: {
            "base_url": "https://uniart.fun/v1",
            "api_key": "test-key",
        }),
    ):
        result = complete_h3_context_ir(
            SimpleNamespace(owner_profile_id="owner"),
            [{"type": "text", "text": "raw prompt"}],
            5,
            "16:9",
            "agent-test-12345678",
        )

    assert result == "refined prompt"
    assert captured["url"].endswith("/video/context-ir")
    assert captured["body"] == {
        "model": "minimax-h3-ir",
        "content": [{"type": "text", "text": "raw prompt"}],
        "duration": 5,
        "ratio": "16:9",
        "idempotency_key": "agent-test-12345678",
    }
