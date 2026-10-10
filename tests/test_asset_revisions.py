from threading import RLock

import pytest

from src.apps.comic_gen.models import (
    GlobalAssetLibrary, ImageAsset, ImageVariant, Scene, Script, Series,
    StoryboardFrame, StoryboardReferencePackage,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


def make_pipeline(tmp_path):
    variants = [
        ImageVariant(id="first", url="assets/first.png", media_id="media-first"),
        ImageVariant(id="second", url="assets/second.png", media_id="media-second"),
    ]
    scene = Scene(id="cinema", name="Cinema", description="Lobby",
                  image_asset=ImageAsset(selected_id="first", variants=variants))
    frame = StoryboardFrame(id="frame", scene_id="cinema")
    script = Script(id="project", title="Project", original_text="", scenes=[scene],
                    frames=[frame], created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline._save_lock = RLock()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._initialize_asset_revisions()
    return pipeline, script, scene, frame


def test_asset_revisions_survive_reload_and_shot_pin_does_not_drift(tmp_path):
    pipeline, script, scene, frame = make_pipeline(tmp_path)
    assert scene.asset_revision == 1
    assert scene.asset_revisions[0].confirmation_status == "legacy_attached"

    pipeline.update_frame("project", "frame", reference_package=StoryboardReferencePackage(
        first_frame_url="storyboard/frame.png", confirmed=True))
    pinned = frame.reference_package.asset_revision_pins[0]
    assert (pinned.asset_id, pinned.revision, pinned.variant_id, pinned.media_id) == (
        "cinema", 1, "first", "media-first")

    pipeline.select_asset_variant("project", "cinema", "scene", "second")
    assert scene.asset_revision == 2
    assert scene.asset_revisions[0].snapshot["image_asset"]["selected_id"] == "first"
    assert scene.asset_revisions[1].snapshot["image_asset"]["selected_id"] == "second"
    assert frame.reference_package.asset_revision_pins[0] == pinned
    selection = pipeline.resolve_storyboard_asset_selection("project", "frame")
    assert selection["assets"][0]["revision"] == 1
    assert selection["assets"][0]["variant_id"] == "first"
    assert selection["assets"][0]["source"] == "pinned_asset_revision"

    pipeline.get_script = lambda script_id: pipeline.scripts.get(script_id)
    _, task_id = pipeline.create_video_task(
        "project", "", "Prompt", frame_id="frame", model="wan2.7-i2v")
    task = next(item for item in script.video_tasks if item.id == task_id)
    assert task.asset_revision_pins == [pinned]

    reloaded = ComicGenPipeline.__new__(ComicGenPipeline)
    reloaded.data_file = pipeline.data_file
    restored = reloaded._load_data()["project"]
    assert restored.scenes[0].asset_revision == 2
    assert len(restored.scenes[0].asset_revisions) == 2
    assert restored.frames[0].reference_package.asset_revision_pins == [pinned]
    assert restored.video_tasks[0].asset_revision_pins == [pinned]


def test_confirm_membership_is_atomic_and_preserves_historical_material(tmp_path):
    pipeline, _, scene, _ = make_pipeline(tmp_path)
    with pytest.raises(ValueError, match="Selected variant must remain active"):
        pipeline.confirm_asset_revision(
            "project", "cinema", "scene", 1, ["first"], "second")
    assert [item.id for item in scene.image_asset.variants] == ["first", "second"]
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.confirm_asset_revision("project", "cinema", "scene", 2)

    result = pipeline.confirm_asset_revision(
        "project", "cinema", "scene", 1, ["second"], "second")
    assert result["revision"]["confirmation_status"] == "user_confirmed"
    assert scene.asset_revision == 2
    assert [item.id for item in scene.image_asset.variants] == ["second"]
    assert [item["id"] for item in scene.asset_revisions[0].snapshot["image_asset"]["variants"]] == [
        "first", "second"]
    assert [item.id for item in scene.image_asset.variants] == ["second"]

    again = pipeline.confirm_asset_revision("project", "cinema", "scene", 2)
    assert again["revision"]["revision"] == 2


def test_changing_frame_asset_reference_invalidates_confirmation(tmp_path):
    pipeline, _, _, frame = make_pipeline(tmp_path)
    pipeline.update_frame("project", "frame", reference_package=StoryboardReferencePackage(
        first_frame_url="storyboard/frame.png", confirmed=True))
    assert frame.reference_package.asset_revision_pins

    pipeline.update_frame("project", "frame", scene_id="new-scene")

    assert frame.reference_package.confirmed is False
    assert frame.reference_package.asset_revision_pins == []
    assert frame.reference_package.revision == 3


def test_confirmed_pin_survives_current_asset_removal(tmp_path):
    pipeline, script, _, frame = make_pipeline(tmp_path)
    pipeline.update_frame("project", "frame", reference_package=StoryboardReferencePackage(
        first_frame_url="storyboard/frame.png", confirmed=True))
    script.scenes = []
    frame.scene_id = ""

    selected = pipeline.resolve_storyboard_asset_selection("project", "frame")

    assert [(item["asset_id"], item["variant_id"], item["media_id"])
            for item in selected["assets"]] == [("cinema", "first", "media-first")]


def test_series_and_library_revisions_are_persisted(tmp_path):
    pipeline, _, _, _ = make_pipeline(tmp_path)
    pipeline.series_data_file = str(tmp_path / "series.json")
    pipeline.library_data_file = str(tmp_path / "library.json")
    pipeline.series_store = {"series": Series(
        id="series", title="Series", scenes=[Scene(id="shared", name="Shared",
                                                     description="Place")],
        created_at=1, updated_at=1)}
    pipeline.library_store.scenes.append(Scene(id="global", name="Global", description="Place"))

    pipeline._save_series_data()
    pipeline._save_library_data()
    pipeline.series_store["series"].scenes[0].description = "Revised"
    pipeline.library_store.scenes[0].description = "Revised"
    pipeline._save_series_data()
    pipeline._save_library_data()

    assert pipeline._load_series_data()["series"].scenes[0].asset_revision == 2
    assert pipeline._load_library_data().scenes[0].asset_revision == 2


def test_restore_creates_new_revision_without_retargeting_shot(tmp_path):
    pipeline, _, scene, frame = make_pipeline(tmp_path)
    pipeline.update_frame("project", "frame", reference_package=StoryboardReferencePackage(
        first_frame_url="storyboard/frame.png", confirmed=True))
    pipeline.select_asset_variant("project", "cinema", "scene", "second")

    restored = pipeline.restore_asset_revision("project", "cinema", "scene", 1, 2)

    assert restored["revision"]["revision"] == 3
    assert scene.image_asset.selected_id == "first"
    assert [item.revision for item in scene.asset_revisions] == [1, 2, 3]
    assert scene.asset_revisions[1].snapshot["image_asset"]["selected_id"] == "second"
    assert frame.reference_package.asset_revision_pins[0].revision == 1
    with pytest.raises(ValueError, match="revision changed"):
        pipeline.restore_asset_revision("project", "cinema", "scene", 2, 2)

    repeated = pipeline.restore_asset_revision("project", "cinema", "scene", 1, 3)
    assert repeated["revision"]["revision"] == 4


def test_new_package_scene_reference_pins_its_exact_variant(tmp_path):
    pipeline, script, _, frame = make_pipeline(tmp_path)
    script.scenes.append(Scene(
        id="room", name="Room", description="Room",
        image_asset=ImageAsset(selected_id="other", variants=[
            ImageVariant(id="other", url="assets/other.png", media_id="media-other"),
            ImageVariant(id="chosen", url="assets/chosen.png", media_id="media-chosen"),
        ]),
    ))
    package = StoryboardReferencePackage(confirmed=True, references=[{
        "kind": "scene", "url": "assets/chosen.png", "media_id": "media-chosen",
        "source_asset_id": "room", "source_variant_id": "chosen",
    }])

    pipeline.update_frame("project", "frame", reference_package=package)

    pins = {(item.asset_id, item.variant_id) for item in frame.reference_package.asset_revision_pins}
    assert pins == {("cinema", "first"), ("room", "chosen")}


def test_rejects_scene_reference_with_mismatched_variant_url(tmp_path):
    pipeline, _, _, _ = make_pipeline(tmp_path)
    package = StoryboardReferencePackage(confirmed=True, references=[{
        "kind": "scene", "url": "assets/wrong.png",
        "source_asset_id": "cinema", "source_variant_id": "first",
    }])
    with pytest.raises(ValueError, match="Referenced URL does not match"):
        pipeline.update_frame("project", "frame", reference_package=package)
