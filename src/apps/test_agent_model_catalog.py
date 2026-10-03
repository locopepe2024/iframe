from src.apps.agent_api import _agent_chat_models


def test_h3_ir_is_optional_agent_prompt_optimization_model():
    models = _agent_chat_models([
        {"api_model_id": "qwen3.8-flash", "capabilities": ["chat"]},
        {"api_model_id": "minimax-h3-ir", "capabilities": ["chat"]},
        {"api_model_id": "minimax-h3-vip", "capabilities": ["i2v"]},
    ])

    assert [model["api_model_id"] for model in models] == ["qwen3.8-flash", "minimax-h3-ir"]
    h3_ir = models[-1]
    assert h3_ir["display_name"] == "MiniMax H3 IR（提示词优化）"
    assert h3_ir["agent_capability"] == "h3_prompt_optimization"


def test_h3_ir_is_not_shown_when_upstream_catalog_does_not_expose_it():
    models = _agent_chat_models([
        {"api_model_id": "qwen3.8-flash", "capabilities": ["chat"]},
    ])

    assert all(model["api_model_id"] != "minimax-h3-ir" for model in models)
