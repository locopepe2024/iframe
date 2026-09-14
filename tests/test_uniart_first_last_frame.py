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

    def fake_post(path, body):
        captured["path"] = path
        captured["body"] = body
        return {"task_id": "task-frames"}

    monkeypatch.setattr(uniart, "_post", fake_post)
    monkeypatch.setattr(uniart, "_poll", lambda task_id: {"result_url": "https://example.com/result.mp4"})
    monkeypatch.setattr(uniart, "_download", lambda url, output_path: output_path)

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


def test_uniart_result_url_accepts_content_metadata():
    assert uniart._result_url({"content": {"video_url": "https://example.com/video.mp4"}}, "video") == "https://example.com/video.mp4"
