from src.apps.user_config import _runtime_base_url


def test_internal_gateway_only_replaces_matching_public_node(monkeypatch):
    monkeypatch.setenv("UNIART_BASE_URL", "https://srv2021949.hstgr.cloud/v1")
    monkeypatch.setenv("UNIART_INTERNAL_BASE_URL", "http://172.17.0.1:3000/v1")

    assert _runtime_base_url({}) == "http://172.17.0.1:3000/v1"
    assert _runtime_base_url({"UNIART_BASE_URL": "https://other.example/v1"}) == "https://other.example/v1"
