import pytest

pytest.importorskip("dashscope")

from src.models import uniart


class _DownloadResponse:
    def __init__(self, status_code, payload=b""):
        self.status_code = status_code
        self.payload = payload
        self.content = payload

    def close(self):
        return None

    def raise_for_status(self):
        if self.status_code >= 400:
            raise uniart.requests.HTTPError(response=self)

    def iter_content(self, _chunk_size):
        yield self.payload


def test_uniart_video_uses_canonical_first_last_frame_content(monkeypatch, tmp_path):
    captured = {}

    def fake_post(_config, path, body):
        captured["path"] = path
        captured["body"] = body
        return {"task_id": "task-frames"}

    monkeypatch.setattr(uniart, "_post", fake_post)
    monkeypatch.setattr(uniart, "_poll", lambda _config, task_id, **_kwargs: {"result_url": "https://example.com/result.mp4"})
    monkeypatch.setattr(uniart, "_download", lambda _config, url, output_path: output_path)

    output = tmp_path / "frames.mp4"
    uniart.UniArtVideoModel({}).generate(
        "camera moves between frames",
        str(output),
        model="minimax-h3-vip",
        first_frame="https://example.com/first.jpg",
        last_frame="https://example.com/last.jpg",
        duration=5,
        resolution="720p",
        aspect_ratio="16:9",
    )

    assert captured["path"] == "/videos"
    assert captured["body"]["content"] == [
        {
            "type": "image_url",
            "role": "first_frame",
            "image_url": {"url": "https://example.com/first.jpg"},
        },
        {
            "type": "image_url",
            "role": "last_frame",
            "image_url": {"url": "https://example.com/last.jpg"},
        },
    ]
    assert "input_reference" not in captured["body"]


def test_uniart_media_download_retries_transient_502(monkeypatch, tmp_path):
    responses = iter([_DownloadResponse(502), _DownloadResponse(200, b"video")])
    monkeypatch.setattr(uniart.requests, "get", lambda *args, **kwargs: next(responses))
    monkeypatch.setattr(uniart.time, "sleep", lambda _seconds: None)

    output = tmp_path / "result.mp4"
    assert uniart._download({"api_key": "test-key"}, "https://example.com/content", str(output)) == str(output)
    assert output.read_bytes() == b"video"


def test_uniart_signed_storage_download_does_not_forward_bearer(monkeypatch, tmp_path):
    captured = {}

    def fake_get(_url, **kwargs):
        captured["headers"] = kwargs["headers"]
        return _DownloadResponse(200, b"image")

    monkeypatch.setattr(uniart.requests, "get", fake_get)
    output = tmp_path / "result.png"
    uniart._download(
        {"api_key": "test-key", "base_url": "https://uniart.fun/v1"},
        "https://storage.iyishow.com/uniart-cache/images/result.png?sign=test",
        str(output),
    )

    assert "Authorization" not in captured["headers"]


def test_uniart_content_download_keeps_bearer(monkeypatch, tmp_path):
    captured = {}

    def fake_get(_url, **kwargs):
        captured["headers"] = kwargs["headers"]
        return _DownloadResponse(200, b"video")

    monkeypatch.setattr(uniart.requests, "get", fake_get)
    output = tmp_path / "result.mp4"
    uniart._download(
        {"api_key": "test-key", "base_url": "https://uniart.fun/v1"},
        "https://uniart.fun/v1/videos/task-1/content",
        str(output),
    )

    assert captured["headers"]["Authorization"] == "Bearer test-key"


def test_uniart_result_url_accepts_content_metadata():
    assert uniart._result_url({"content": {"video_url": "https://example.com/video.mp4"}}, "video") == "https://example.com/video.mp4"


def test_uniart_result_url_prefers_signed_storage_artifact():
    signed = "https://storage.iyishow.com/result.png?sign=abc"
    assert uniart._result_url(
        {"result_url": "https://uniart.fun/v1/images/task-1/content", "output": {"image_url": signed}},
        "image",
    ) == signed


def test_uniart_image_uses_image_task_endpoint_and_data_url(monkeypatch, tmp_path):
    captured = {}

    def fake_post(_config, path, body):
        captured["post_path"] = path
        return {"task_id": "image-task"}

    def fake_poll(_config, task_id, **kwargs):
        captured["task_id"] = task_id
        captured["poll_endpoint"] = kwargs["endpoint"]
        return {"object": "image.task", "status": "completed", "data": [{"url": "https://storage.iyishow.com/result.png?sign=x"}]}

    monkeypatch.setattr(uniart, "_post", fake_post)
    monkeypatch.setattr(uniart, "_poll", fake_poll)
    monkeypatch.setattr(uniart, "_download", lambda _config, url, output_path: output_path)

    output = tmp_path / "result.png"
    uniart.UniArtImageModel({}).generate("a test image", str(output), model_name="gpt-image-2")

    assert captured == {"post_path": "/images/generations", "task_id": "image-task", "poll_endpoint": "images"}
    assert uniart._result_url({"data": [{"url": "https://storage.iyishow.com/result.png?sign=x"}]}, "image").startswith("https://storage.iyishow.com/")
