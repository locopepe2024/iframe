from unittest.mock import Mock

from src.models import uniart


def test_poll_default_has_no_client_deadline(monkeypatch):
    responses = []

    class Response:
        status_code = 200
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": responses.pop(0)}

    clock = [0]
    monkeypatch.setattr(uniart.time, "time", lambda: clock[0])
    responses.extend(["processing", "completed"])
    monkeypatch.setattr(uniart.requests, "get", Mock(return_value=Response()))
    monkeypatch.setattr(uniart.time, "sleep", lambda _: clock.__setitem__(0, 10000))
    assert uniart._poll({"api_key": "test", "base_url": "https://example.test/v1"}, "task") == {"status": "completed"}


def test_poll_retries_an_empty_or_invalid_json_response(monkeypatch):
    calls = []

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            calls.append("json")
            if len(calls) == 1:
                raise ValueError("empty response body")
            return {"status": "completed"}

    sleeps = []
    monkeypatch.setattr(uniart.requests, "get", Mock(return_value=Response()))
    monkeypatch.setattr(uniart.time, "sleep", sleeps.append)

    assert uniart._poll({"api_key": "test", "base_url": "https://example.test/v1"}, "task") == {
        "status": "completed"
    }
    assert sleeps == [10]
