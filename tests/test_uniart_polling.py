from unittest.mock import Mock

import pytest

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


@pytest.mark.parametrize("status_code", [500, 502, 503])
def test_video_poll_surfaces_provider_5xx_without_retry(monkeypatch, status_code):
    class Response:
        headers = {"X-Oneapi-Request-Id": "request-123"}
        text = '{"error":{"code":"content_review_failed","message":"Content review failed"}}'

        def __init__(self):
            self.status_code = status_code

        def json(self):
            return {"error": {"code": "content_review_failed", "message": "Content review failed"}}

    get = Mock(return_value=Response())
    sleep = Mock()
    monkeypatch.setattr(uniart.requests, "get", get)
    monkeypatch.setattr(uniart.time, "sleep", sleep)

    with pytest.raises(RuntimeError, match=f"UniArt request failed \\({status_code} content_review_failed\\): Content review failed") as caught:
        uniart._poll({"api_key": "secret-key", "base_url": "https://example.test/v1"}, "task-1")

    assert "request-123" in str(caught.value)
    assert "secret-key" not in str(caught.value)
    get.assert_called_once()
    sleep.assert_not_called()
