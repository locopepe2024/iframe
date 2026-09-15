import pytest

pytest.importorskip("dashscope")

from src.models import uniart


class _ErrorResponse:
    status_code = 500
    text = '{"error":{"code":"get_channel_failed","message":"route candidates not found"}}'
    headers = {"X-Oneapi-Request-Id": "request-123"}

    def json(self):
        return {"error": {"code": "get_channel_failed", "message": "route candidates not found"}}

    def raise_for_status(self):
        raise uniart.requests.HTTPError(response=self)


def test_post_preserves_provider_error_without_request_body(monkeypatch):
    response = _ErrorResponse()
    monkeypatch.setattr(uniart.requests, "post", lambda *args, **kwargs: response)

    try:
        uniart._post(
            {"api_key": "secret-key", "base_url": "https://uniart.fun/v1"},
            "/images/generations",
            {"model": "gpt-image-2.5-flare-special", "prompt": "private prompt"},
        )
    except RuntimeError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected provider error")

    assert "500" in message
    assert "get_channel_failed" in message
    assert "route candidates not found" in message
    assert "request-123" in message
    assert "secret-key" not in message
    assert "private prompt" not in message
