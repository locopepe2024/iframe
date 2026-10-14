from unittest.mock import Mock

import pytest

from src.models import nsfw_new_one


def test_seedream_uses_nsfw_node_and_saves_result_locally(monkeypatch, tmp_path):
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "http://172.17.0.1:3000/v1")
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs["json"]))
        return Mock(status_code=200, json=lambda: {"data": [{"url": "https://result.example/image.jpg"}]})

    def get(url, **_kwargs):
        assert url == "https://result.example/image.jpg"
        return Mock(status_code=200, content=b"image")

    monkeypatch.setattr(nsfw_new_one.requests, "post", post)
    monkeypatch.setattr(nsfw_new_one.requests, "get", get)
    target = tmp_path / "storyboard" / "image.jpg"
    adapter = nsfw_new_one.NSFWNewOneImageModel({"api_key": "test", "base_url": "https://elsewhere.example/v1"})
    adapter.generate("portrait", str(target), model_name="nsfw/seedream_5.0Pro_nsfw", size="576*1024")

    assert calls == [("http://172.17.0.1:3000/v1/images/generations", {
        "model": "seedream_5.0Pro_nsfw", "prompt": "portrait", "resolution": "1K", "aspect_ratio": "9:16",
    })]
    assert target.read_bytes() == b"image"


def test_seedream_reference_uses_local_signed_media(monkeypatch, tmp_path):
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "http://172.17.0.1:3000/v1")
    monkeypatch.setattr(nsfw_new_one, "signed_provider_media_url", lambda path: "http://nsfw.example/provider/media/signed")
    monkeypatch.setattr(nsfw_new_one.requests, "post", lambda url, **kwargs: (
        pytest.fail("wrong endpoint") if not url.endswith("/images/edits") else
        Mock(json=lambda: {"data": [{"url": "https://result.example/image.jpg"}]})
    ))
    monkeypatch.setattr(nsfw_new_one.requests, "get", lambda *args, **kwargs: Mock(content=b"image"))
    target = tmp_path / "image.jpg"
    nsfw_new_one.NSFWNewOneImageModel({"api_key": "test"}).generate(
        "portrait", str(target), model_name="nsfw/seedream_5.0Pro_nsfw", ref_image_paths=["asset.jpg"],
    )
    assert target.read_bytes() == b"image"


def test_seedream_requires_explicit_nsfw_node(monkeypatch):
    monkeypatch.delenv("NSFW_NEW_ONE_BASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="NSFW_NEW_ONE_BASE_URL"):
        nsfw_new_one.NSFWNewOneImageModel({"api_key": "test"})


def test_seedream_polls_new_one_image_task(monkeypatch, tmp_path):
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "http://172.17.0.1:3000/v1")
    monkeypatch.setattr(nsfw_new_one.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(nsfw_new_one.requests, "post", lambda *_args, **_kwargs: Mock(
        json=lambda: {"id": "task-1", "status": "queued"},
    ))
    calls = []

    def get(url, **_kwargs):
        calls.append(url)
        if url.endswith("/images/task-1"):
            return Mock(json=lambda: {"status": "completed", "data": [{"url": "https://result.example/image.jpg"}]})
        return Mock(content=b"image")

    monkeypatch.setattr(nsfw_new_one.requests, "get", get)
    output = tmp_path / "image.jpg"
    nsfw_new_one.NSFWNewOneImageModel({"api_key": "test"}).generate("portrait", str(output))
    assert calls == ["http://172.17.0.1:3000/v1/images/task-1", "https://result.example/image.jpg"]
    assert output.read_bytes() == b"image"
