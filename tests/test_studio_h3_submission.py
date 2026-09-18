"""Capture Studio's actual gateway request without paid generation."""
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import Script, VideoTask
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.models import uniart
from src.apps.studio_access import resolve_studio_reference, studio_owner_dir, studio_media_url
from pathlib import Path


@pytest.fixture
def studio(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    script = Script(id="project", title="Recreation", original_text="", created_at=0,
                    updated_at=0, owner_user_id="user", owner_profile_id="profile")
    pipeline.get_script = lambda ident: script if ident == script.id else None
    pipeline._save_data = Mock()
    pipeline._resolve_video_backend = lambda model: "uniart"
    monkeypatch.setattr("src.apps.comic_gen.pipeline.runtime_uniart_for_owner", lambda *a: {})
    monkeypatch.setattr(uniart, "_media", lambda value: value)
    monkeypatch.setattr(uniart, "_poll", Mock(return_value={}))
    monkeypatch.setattr(uniart, "_download_result", Mock())
    monkeypatch.setattr(uniart, "_post", Mock(return_value={"id": "provider-task"}))
    return pipeline, script


@pytest.mark.parametrize("model", ["uniart/minimax-h3-vip", "uniart/seedance-2.0-vip"])
def test_explicit_gateway_model_survives_r2v_creation(studio, model):
    pipeline, script = studio
    pipeline.create_video_task(script.id, "", "replace product", model=model,
                              generation_mode="r2v", reference_image_urls=["https://cdn.example/product.jpg"],
                              reference_video_urls=["https://cdn.example/source.mp4"])
    assert script.video_tasks[0].model == model


def test_h3_video_only_reference_is_valid(studio):
    pipeline, script = studio
    pipeline.create_video_task(script.id, "", "follow motion", model="uniart/minimax-h3-vip",
                              generation_mode="r2v", reference_video_urls=["https://cdn.example/source.mp4"])
    assert script.video_tasks[0].model == "uniart/minimax-h3-vip"


def test_h3_missing_references_rejected_before_task_creation(studio):
    pipeline, script = studio
    with pytest.raises(ValueError, match="references"):
        pipeline.create_video_task(script.id, "", "replace", model="uniart/minimax-h3-vip",
                                  generation_mode="r2v")
    assert not script.video_tasks


def task(script, **overrides):
    values = dict(id="take", project_id=script.id, image_url="", prompt="replace product",
                  model="uniart/minimax-h3-vip", generation_mode="r2v", duration=6,
                  resolution="2k", ratio="16:9", reference_image_urls=["https://cdn.example/product.jpg"],
                  reference_video_urls=["https://cdn.example/source.mp4"], generate_audio=False)
    values.update(overrides)
    result = VideoTask(**values)
    script.video_tasks.append(result)
    return result


def test_studio_sends_image_and_source_video_with_explicit_mode(studio):
    pipeline, script = studio
    current = task(script)
    pipeline.process_video_task(script.id, current.id)
    body = uniart._post.call_args.args[2]
    assert body["model"] == "minimax-h3-vip"
    assert body["mode"] == "reference2video"
    assert body["duration"] == 6 and body["generate_audio"] is False
    assert body["content"][1:] == [
        {"type": "image_url", "role": "reference_image", "image_url": {"url": "https://cdn.example/product.jpg"}},
        {"type": "video_url", "role": "reference_video", "video_url": {"url": "https://cdn.example/source.mp4"}},
    ]
    assert current.provider_task_id == "provider-task"
    assert current.provider_name == "uniart"
    assert current.status == "completed"


@pytest.mark.parametrize("model,duration,expected", [
    ("uniart/seedance-2.5-vip", 3, 4),
    ("uniart/minimax-h3-vip", 3, 4),
    ("uniart/minimax-h3-vip", 20, 15),
])
def test_storyboard_duration_is_normalized_at_uniart_submission(studio, model, duration, expected):
    pipeline, script = studio
    current = task(script, model=model, duration=duration)
    pipeline.process_video_task(script.id, current.id)
    assert uniart._post.call_args.args[2]["duration"] == expected
    assert current.duration == duration


def owned_file(owner, name="product.jpg"):
    path = Path(studio_owner_dir(owner)) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fixture")
    return path


def test_signed_reference_becomes_stable_owned_path(studio, monkeypatch):
    _, script = studio
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-only")
    path = owned_file(script.owner_profile_id)
    stored = path.relative_to("output").as_posix()
    signed = studio_media_url(script.owner_profile_id, stored)
    assert resolve_studio_reference(signed, script.owner_profile_id) == stored
    with pytest.raises(ValueError, match="another owner"):
        resolve_studio_reference(signed, "foreign")
    with pytest.raises(ValueError, match="expired"):
        resolve_studio_reference(studio_media_url(script.owner_profile_id, stored, -10), script.owner_profile_id)


@pytest.mark.parametrize("kind", ["foreign", "symlink", "traversal"])
def test_foreign_local_references_rejected_before_submission(studio, kind):
    pipeline, script = studio
    foreign = owned_file("foreign")
    if kind == "symlink":
        ref = Path(studio_owner_dir(script.owner_profile_id)) / "link.jpg"
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.symlink_to(foreign.resolve())
    elif kind == "traversal":
        ref = Path(studio_owner_dir(script.owner_profile_id)) / ".." / ".." / foreign.parent.parent.name / "studio" / foreign.name
    else:
        ref = foreign
    current = task(script, reference_image_urls=[str(ref)])
    pipeline.process_video_task(script.id, current.id)
    uniart._post.assert_not_called()
    assert current.status == "failed"
    assert "another owner" in current.error


@pytest.mark.parametrize("mode,kwargs", [
    ("i2v", {"image_url": "https://cdn.example/product.jpg", "audio_url": "https://cdn.example/sound.wav"}),
    ("t2v", {"reference_video_urls": ["https://cdn.example/source.mp4"]}),
    ("r2v", {"image_url": "https://cdn.example/product.jpg", "audio_url": "https://cdn.example/sound.wav"}),
])
def test_incompatible_inputs_rejected(studio, mode, kwargs):
    pipeline, script = studio
    kwargs = dict(kwargs)
    image_url = kwargs.pop("image_url", "")
    with pytest.raises(ValueError):
        pipeline.create_video_task(script.id, image_url, "test", model="uniart/minimax-h3-vip",
                                   generation_mode=mode, **kwargs)
    assert not script.video_tasks


def test_owned_i2v_snapshot_retains_owner_path(studio):
    pipeline, script = studio
    path = owned_file(script.owner_profile_id)
    pipeline.create_video_task(script.id, str(path), "test", model="uniart/minimax-h3-vip", generation_mode="i2v")
    snapshot = script.video_tasks[0].image_url
    assert snapshot.startswith(Path(studio_owner_dir(script.owner_profile_id)).relative_to("output").as_posix() + "/")
    assert (Path("output") / snapshot).read_bytes() == b"fixture"


def test_audio_reference_reaches_gateway(studio):
    pipeline, script = studio
    current = task(script, audio_url="https://cdn.example/sound.wav")
    pipeline.process_video_task(script.id, current.id)
    assert current.status == "completed"
    assert uniart._post.call_args.args[2]["content"][-1] == {
        "type": "audio_url", "role": "reference_audio", "audio_url": {"url": "https://cdn.example/sound.wav"}}


def test_saved_provider_task_resumes_without_another_post(studio):
    pipeline, script = studio
    current = task(script, provider_task_id="existing", provider_name="uniart")
    pipeline.process_video_task(script.id, current.id)
    uniart._post.assert_not_called()
    assert uniart._poll.call_args.args[1] == "existing"
    assert current.status == "completed"


def test_acceptance_saved_before_poll_failure(studio):
    pipeline, script = studio
    current = task(script)
    def fail_poll(*args):
        assert current.provider_task_id == "provider-task"
        assert pipeline._save_data.call_count >= 2
        raise RuntimeError("poll unavailable")
    uniart._poll.side_effect = fail_poll
    pipeline.process_video_task(script.id, current.id)
    assert current.status == "failed"
    assert "poll unavailable" in current.error
    assert current.provider_task_id == "provider-task"
