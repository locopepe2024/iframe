from types import SimpleNamespace

import pytest

from src.models import uniart


class Response:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.headers = {}
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise uniart.requests.HTTPError(response=self)


def test_context_ir_submits_to_dedicated_async_endpoint(monkeypatch):
    calls = []

    def post(url, **kwargs):
        calls.append(("post", url, kwargs["json"]))
        return Response({"id": "ir_1", "status": "pending"}, 202)

    monkeypatch.setattr(uniart.requests, "post", post)
    created = uniart.submit_context_ir(
        {"base_url": "https://uniart.fun/v1", "api_key": "test"},
        [{"type": "text", "text": "draft"}],
        duration=15,
        ratio="9:16",
        idempotency_key="test-ir-1",
    )

    assert created["id"] == "ir_1"
    assert calls[0][1] == "https://uniart.fun/v1/video/context-ir"
    assert calls[0][2]["model"] == "minimax-h3-ir"
    assert calls[0][2]["duration"] == 15
    assert calls[0][2]["ratio"] == "9:16"


def test_context_ir_polls_pending_processing_and_reads_top_level_prompt(monkeypatch):
    statuses = iter([
        {"id": "ir_1", "status": "pending"},
        {"id": "ir_1", "status": "processing"},
        {"id": "ir_1", "status": "succeeded", "prompt": "optimized"},
    ])
    monkeypatch.setattr(uniart.requests, "get", lambda *args, **kwargs: Response(next(statuses)))
    monkeypatch.setattr(uniart.time, "sleep", lambda *_args: None)

    result = uniart._poll_context_ir(
        {"base_url": "https://uniart.fun/v1", "api_key": "test"},
        "ir_1",
        max_wait=10,
        interval=1,
    )
    assert result["prompt"] == "optimized"


def test_context_ir_failed_status_is_the_terminal_failure(monkeypatch):
    monkeypatch.setattr(
        uniart.requests,
        "get",
        lambda *args, **kwargs: Response({"id": "ir_1", "status": "failed", "error": "bad reference"}),
    )
    with pytest.raises(RuntimeError, match="bad reference"):
        uniart._poll_context_ir(
            {"base_url": "https://uniart.fun/v1", "api_key": "test"},
            "ir_1",
            max_wait=10,
            interval=1,
        )


def test_context_ir_never_uses_video_or_chat_endpoint(monkeypatch):
    paths = []

    def post(url, **kwargs):
        paths.append(url)
        return Response({"id": "ir_1", "status": "succeeded", "prompt": "optimized"}, 202)

    monkeypatch.setattr(uniart.requests, "post", post)
    monkeypatch.setattr(uniart.requests, "get", lambda *args, **kwargs: pytest.fail("completed IR must not poll"))
    result = uniart.complete_context_ir(
        {"base_url": "https://uniart.fun/v1", "api_key": "test"},
        [{"type": "text", "text": "draft"}],
        duration=5,
        ratio="16:9",
        idempotency_key="test-ir-2",
    )
    assert result == "optimized"
    assert paths == ["https://uniart.fun/v1/video/context-ir"]
