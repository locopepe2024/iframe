from unittest.mock import Mock
from pathlib import Path

import pytest

from src.apps.comic_gen.models import Script, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.models import nsfw_new_one


@pytest.fixture
def studio(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = Script(id="project", title="Video", original_text="", created_at=0,
                    updated_at=0, owner_user_id="user", owner_profile_id="profile")
    pipeline.get_script = lambda ident: script if ident == script.id else None
    pipeline._save_data = Mock()
    monkeypatch.setattr("src.apps.comic_gen.pipeline.runtime_nsfw_for_owner",
                        lambda *_args: {"api_key": "test"})
    monkeypatch.setenv("NSFW_NEW_ONE_BASE_URL", "http://172.17.0.1:3000/v1")
    return pipeline, script


@pytest.mark.parametrize("model", ["nsfw/wan3.0", "nsfw/wan3.0-Prime"])
def test_wan_r2v_creation_preserves_model(studio, model):
    pipeline, script = studio
    pipeline.create_video_task(script.id, "", "motion", model=model, generation_mode="r2v",
                               reference_image_urls=["https://example.com/ref.png"])
    assert script.video_tasks[0].model == model


def test_wan_rejects_unsupported_video_reference(studio):
    pipeline, script = studio
    with pytest.raises(ValueError, match="image references only"):
        pipeline.create_video_task(script.id, "", "motion", model="nsfw/wan3.0",
                                   generation_mode="r2v", reference_video_urls=["https://example.com/ref.mp4"])
    assert not script.video_tasks


def test_wan_submits_polls_and_saves_locally(studio, monkeypatch):
    pipeline, script = studio
    task = VideoTask(id="take", project_id=script.id, image_url="", prompt="motion",
                     model="nsfw/wan3.0-Prime", generation_mode="r2v", duration=4,
                     resolution="480p", ratio="16:9",
                     reference_image_urls=["https://example.com/ref.png"])
    script.video_tasks.append(task)
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs["json"]))
        return Mock(json=lambda: {"id": "remote-video", "status": "queued"})

    class Media:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def raise_for_status(self):
            return None

        def iter_content(self, _size):
            return iter([b"mp4"])

    def get(url, **_kwargs):
        if url.endswith("/videos/remote-video"):
            return Mock(json=lambda: {"status": "completed", "video_url": "https://example.com/video.mp4"})
        assert url == "https://example.com/video.mp4"
        return Media()

    monkeypatch.setattr(nsfw_new_one.requests, "post", post)
    monkeypatch.setattr(nsfw_new_one.requests, "get", get)
    pipeline.process_video_task(script.id, task.id)

    assert calls == [("http://172.17.0.1:3000/v1/videos", {
        "model": "wan3.0-Prime", "prompt": "motion", "duration": 4,
        "resolution": "480p", "aspect_ratio": "16:9",
        "reference_images": ["https://example.com/ref.png"],
    })]
    assert task.provider_name == "nsfw_new_one"
    assert task.provider_task_id == "remote-video"
    assert task.status == "completed"
    assert (Path(pipeline._owner_output_dir(script, "video")) / "video_take.mp4").read_bytes() == b"mp4"


def test_wan_resume_does_not_submit_again(studio, monkeypatch):
    pipeline, script = studio
    task = VideoTask(id="take", project_id=script.id, image_url="", prompt="motion",
                     model="nsfw/wan3.0", generation_mode="t2v", duration=4,
                     resolution="480p", provider_name="nsfw_new_one", provider_task_id="remote-video")
    script.video_tasks.append(task)
    monkeypatch.setattr(nsfw_new_one.requests, "post", Mock(side_effect=AssertionError("duplicate submission")))
    adapter = Mock()
    adapter.generate.return_value = ("output/video_take.mp4", 1)
    monkeypatch.setattr(nsfw_new_one, "NSFWNewOneVideoModel", lambda _config: adapter)
    pipeline.process_video_task(script.id, task.id)
    assert adapter.generate.call_args.kwargs["resume_task_id"] == "remote-video"
