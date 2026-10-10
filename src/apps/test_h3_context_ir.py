from types import SimpleNamespace

from src.apps.agent_api import _agent_chat_models, complete_h3_context_ir


def test_h3_ir_is_optional_agent_capability():
    models = _agent_chat_models([
        {"api_model_id": "qwen3.8-flash", "capabilities": ["chat"]},
        {"api_model_id": "minimax-h3-ir", "capabilities": ["context_ir"]},
        {"api_model_id": "minimax-h3-vip", "capabilities": ["i2v"]},
    ])
    assert [item["api_model_id"] for item in models] == ["qwen3.8-flash", "minimax-h3-ir"]
    assert models[-1]["agent_capability"] == "h3_prompt_optimization"


def test_h3_ir_not_exposed_when_catalog_omits_capability():
    models = _agent_chat_models([{"api_model_id": "qwen3.8-flash", "capabilities": ["chat"]}])
    assert all(item["api_model_id"] != "minimax-h3-ir" for item in models)


def test_agent_h3_ir_delegates_to_dedicated_adapter(monkeypatch):
    observed = {}

    def fake_complete(config, content, **kwargs):
        observed.update(config=config, content=content, kwargs=kwargs)
        return "optimized prompt"

    monkeypatch.setattr("src.models.uniart.complete_context_ir", fake_complete)
    monkeypatch.setattr(
        "src.apps.agent_api.get_user_config_store",
        lambda: SimpleNamespace(get_runtime_uniart=lambda _ctx: {"base_url": "https://uniart.fun/v1", "api_key": "key"}),
    )
    result = complete_h3_context_ir(SimpleNamespace(), [{"type": "text", "text": "draft"}], 5, "16:9", "agent-key")
    assert result == "optimized prompt"
    assert observed["kwargs"] == {"duration": 5, "ratio": "16:9", "idempotency_key": "agent-key"}
