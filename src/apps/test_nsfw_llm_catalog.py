from src.apps.agent_api import _agent_chat_models


def test_channel_three_models_use_exact_upstream_ids():
    ids = ("deepseek-v4.1-flash-peak", "kimi-k3", "glm-5.3")
    models = _agent_chat_models([{"api_model_id": model, "capabilities": ["chat"]} for model in ids])

    assert {model["api_model_id"] for model in models} == set(ids)
    assert all(model["display_name"] for model in models)
