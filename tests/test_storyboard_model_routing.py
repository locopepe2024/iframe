import time
from pathlib import Path
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import GenerationStatus, ModelSettings, Script, Series, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.storyboard import StoryboardGenerator


@pytest.mark.parametrize("model_name", ["uniart/gpt-image-2"])
def test_storyboard_routes_uniart_image_models_to_uniart_adapter(monkeypatch, tmp_path, model_name):
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: path
    monkeypatch.setattr(
        "src.models.uniart.UniArtImageModel",
        lambda _config: adapter,
    )
    monkeypatch.setattr(
        "src.apps.comic_gen.storyboard.studio_uniart_config",
        lambda: {"UNIART_API_KEY": "test"},
    )

    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    frame = StoryboardFrame(
        id="frame-1",
        scene_id="scene-1",
        action_description="A person enters the street",
    )

    generator.generate_frame(
        frame,
        characters=[],
        scene=None,
        prompt="A person enters the street",
        model_name=model_name,
    )

    adapter.generate.assert_called_once()
    assert adapter.generate.call_args.kwargs["model_name"] == model_name
    assert frame.status == GenerationStatus.COMPLETED


def test_storyboard_generation_failure_is_not_returned_as_success(tmp_path):
    generator = StoryboardGenerator({"output_dir": str(tmp_path)})
    generator.model.generate = Mock(side_effect=RuntimeError("provider rejected request"))
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")

    with pytest.raises(RuntimeError, match="provider rejected request"):
        generator.generate_frame(frame, [], None, model_name="wan2.7-image-pro")

    assert frame.status == GenerationStatus.FAILED


def test_storyboard_render_keeps_local_file_even_when_oss_is_configured(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "src.utils.oss_utils.OSSImageUploader",
        Mock(side_effect=AssertionError("storyboard must not upload to OSS")),
    )
    adapter = Mock()
    adapter.generate.side_effect = lambda _prompt, path, **_kwargs: (
        Path(path).write_bytes(b"image"), 0,
    )
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneImageModel", lambda _config: adapter)
    monkeypatch.setattr("src.apps.comic_gen.storyboard.studio_nsfw_new_one_config", lambda: {"api_key": "test"})
    generator = StoryboardGenerator({"output_dir": "output/storyboard"})
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")

    generator.generate_frame(frame, [], None, prompt="A street", model_name="nsfw/seedream_5.0Pro_nsfw")

    selected = frame.rendered_image_asset.variants[0]
    assert selected.url.startswith("storyboard/")
    assert (tmp_path / "output" / selected.url).read_bytes() == b"image"
    assert frame.image_url == selected.url


def test_legacy_seedream_selection_uses_nsfw_adapter(monkeypatch):
    adapter = Mock()
    monkeypatch.setattr("src.models.nsfw_new_one.NSFWNewOneImageModel", lambda _config: adapter)
    monkeypatch.setattr("src.apps.comic_gen.storyboard.studio_nsfw_new_one_config", lambda: {"api_key": "test"})

    assert StoryboardGenerator()._get_model_for("uniart/seedream_5.0Pro_nsfw") is adapter


def test_series_storyboard_render_uses_series_i2i_model(tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="episode-1", series_id="series-1", title="Episode", original_text="",
        frames=[frame], model_settings=ModelSettings(i2i_model="uniart/gpt-image-2"),
        created_at=now, updated_at=now,
    )
    series = Series(
        id="series-1", title="Series", model_settings=ModelSettings(
            i2i_model="uniart/gpt-image-2.5-flare-discount"),
        created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {series.id: series}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    pipeline.generate_storyboard_render(script.id, frame.id, None, "A street")

    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["model_name"] == "uniart/gpt-image-2.5-flare-discount"


def test_storyboard_render_resolves_signed_studio_references(monkeypatch, tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="project-1", title="Project", original_text="", frames=[frame],
        owner_profile_id="apikey-owner", created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.storyboard_generator = Mock()
    pipeline._save_data = Mock()
    pipeline.resolve_episode_assets = Mock(return_value={"characters": [], "scenes": []})
    monkeypatch.chdir(tmp_path)
    (tmp_path / "output").mkdir()
    reference = tmp_path / "output" / "reference.png"
    reference.write_bytes(b"image")
    signed_url = "/studio/media/owner/reference.png?expires=123&signature=test"
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.resolve_studio_reference",
        lambda value, owner: "reference.png" if value == signed_url and owner == "apikey-owner" else None,
    )

    pipeline.generate_storyboard_render(
        script.id, frame.id, {"reference_image_urls": [signed_url]}, "A street",
    )

    assert pipeline.storyboard_generator.generate_frame.call_args.kwargs["ref_image_paths"] == [str(reference)]


def test_storyboard_render_rejects_foreign_studio_reference(monkeypatch, tmp_path):
    now = time.time()
    frame = StoryboardFrame(id="frame-1", scene_id="scene-1")
    script = Script(
        id="project-1", title="Project", original_text="", frames=[frame],
        owner_profile_id="apikey-owner", created_at=now, updated_at=now,
    )
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline._save_data = Mock()
    signed_url = "/studio/media/foreign/reference.png?expires=123&signature=test"
    monkeypatch.setattr(
        "src.apps.comic_gen.pipeline.resolve_studio_reference",
        Mock(side_effect=ValueError("Media reference belongs to another owner")),
    )

    with pytest.raises(ValueError, match="another owner"):
        pipeline.generate_storyboard_render(
            script.id, frame.id, {"reference_image_urls": [signed_url]}, "A street",
        )
