import pytest

pytest.importorskip("dashscope")

from src.models import uniart


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
