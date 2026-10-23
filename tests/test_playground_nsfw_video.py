from unittest.mock import Mock

import pytest

from src.apps.playground.models import PlaygroundGeneration, PlaygroundMode
from src.apps.playground.service import PlaygroundService


def generation(model="nsfw/wan3.0", mode=PlaygroundMode.I2V):
    return PlaygroundGeneration(
        id="agent-video", mode=mode, model_id=model, prompt="Move slowly",
        input_media=["https://example.com/frame.jpg"],
        parameters={"duration": 4, "resolution": "480p", "aspect_ratio": "9:16"},
        created_at="2026-10-13T00:00:00+00:00",
    )


@pytest.mark.parametrize("model_id", ["nsfw/wan3.0", "nsfw/wan3.0-Prime"])
def test_agent_wan_video_uses_new_one_and_saves_task(monkeypatch, tmp_path, model_id):
    storage = Mock(output_dir=str(tmp_path))
    service = PlaygroundService(storage, provider_config_loader=lambda: {"api_key": "test"})
    adapter = Mock()

    def submit(prompt, output_path, **kwargs):
        if not kwargs.get("resume_task_id"):
            kwargs["on_task_submitted"]("upstream-video")
        return output_path, 1.0

    adapter.generate.side_effect = submit
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneVideoModel", lambda _config: adapter)
    monkeypatch.setattr(service, "_generate_video_wanx", Mock(side_effect=AssertionError("DashScope selected")))
    gen = generation(model_id)

    service._process_video_generation(gen)

    assert gen.provider_tasks == {"0": "upstream-video"}
    assert storage.update_generation.called
    assert adapter.generate.call_args.kwargs["model"] == model_id
    if model_id == "nsfw/wan3.0":
        assert adapter.generate.call_args.kwargs["img_url"] == "https://example.com/frame.jpg"
        assert adapter.generate.call_args.kwargs["ref_image_urls"] == []
    else:
        assert adapter.generate.call_args.kwargs["ref_image_urls"] == ["https://example.com/frame.jpg"]
    assert adapter.generate.call_args.kwargs["resolution"] == "480p"

    adapter.generate.reset_mock()
    gen.outputs.clear()
    service._process_video_generation(gen, resume_only=True)
    assert adapter.generate.call_args.kwargs == {"model": model_id, "resume_task_id": "upstream-video"}


def test_agent_wan_rejects_video_reference_before_submission(monkeypatch, tmp_path):
    storage = Mock(output_dir=str(tmp_path))
    service = PlaygroundService(storage, provider_config_loader=lambda: {"api_key": "test"})
    adapter = Mock()
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneVideoModel", lambda _config: adapter)
    gen = generation(model="nsfw/wan3.0-Prime", mode=PlaygroundMode.R2V)
    gen.input_media = ["https://example.com/clip.mp4"]

    with pytest.raises(RuntimeError, match="image references only"):
        service._process_video_generation(gen)
    adapter.generate.assert_not_called()


@pytest.mark.parametrize("mode,media,expected", [
    (PlaygroundMode.T2V, [], {"generation_mode": "t2v", "ref_image_urls": []}),
    (PlaygroundMode.F2V, ["https://example.com/first.jpg", "https://example.com/last.jpg"],
     {"generation_mode": "f2v", "img_url": "https://example.com/first.jpg", "last_frame": "https://example.com/last.jpg", "ref_image_urls": []}),
    (PlaygroundMode.R2V, ["https://example.com/a.jpg", "https://example.com/b.mp4", "https://example.com/c.mp3"],
     {"generation_mode": "r2v", "ref_image_urls": ["https://example.com/a.jpg"], "ref_video_urls": ["https://example.com/b.mp4"], "ref_audio_urls": ["https://example.com/c.mp3"]}),
])
def test_c1_playground_dispatches_frame_roles_and_mixed_media(monkeypatch, tmp_path, mode, media, expected):
    service = PlaygroundService(Mock(output_dir=str(tmp_path)), provider_config_loader=lambda: {"api_key": "test"})
    adapter = Mock()
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneVideoModel", lambda _config: adapter)
    gen = generation(mode=mode)
    gen.input_media = media
    gen.parameters["aspect_ratio"] = "adaptive"
    service._generate_video_nsfw(gen, str(tmp_path / "video.mp4"))
    for key, value in expected.items():
        assert adapter.generate.call_args.kwargs[key] == value
    assert adapter.generate.call_args.kwargs["aspect_ratio"] == "adaptive"
