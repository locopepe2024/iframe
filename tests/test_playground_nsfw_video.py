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
    gen = generation(mode=PlaygroundMode.R2V)
    gen.input_media = ["https://example.com/clip.mp4"]

    with pytest.raises(RuntimeError, match="image references only"):
        service._process_video_generation(gen)
    adapter.generate.assert_not_called()


def test_seedream_video_request_is_rejected_before_dashscope_fallback(tmp_path):
    storage = Mock(output_dir=str(tmp_path))
    service = PlaygroundService(storage)
    gen = generation(model="nsfw/seedream_5.0Pro_nsfw")

    with pytest.raises(ValueError, match="image-only"):
        service._process_video_generation(gen)
