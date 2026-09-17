from unittest.mock import Mock

from src.models import uniart


def test_poll_default_has_no_client_deadline(monkeypatch):
    responses = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": responses.pop(0)}

    responses.extend(["processing", "completed"])
    monkeypatch.setattr(uniart.requests, "get", Mock(return_value=Response()))
    monkeypatch.setattr(uniart.time, "sleep", lambda _: None)
    assert uniart._poll({"api_key": "test", "base_url": "https://example.test/v1"}, "task") == {"status": "completed"}
