from threading import RLock
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen.api import GenerateAssetRequest, _require_reviewed_asset_image_prompt
from src.apps.comic_gen.models import Character, ImageAsset, ImageVariant, Scene, Script, Series
from src.apps.comic_gen.pipeline import ComicGenPipeline


def test_queued_scene_variant_keeps_reviewed_submission_when_design_changes():
    scene = Scene(id="street", name="Street", description="A street", asset_design={
        "design_draft": {}, "design_revisions": [{"revision": 1, "design": {"visual_notes": "Blue dusk"}}],
    })
    script = Script(id="project", title="Project", original_text="", scenes=[scene], created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.asset_generation_tasks = {}
    pipeline._save_lock = RLock()
    pipeline._save_after_asset_mutation = MagicMock()
    pipeline._register_asset_media = MagicMock()
    pipeline.effective_director_profile = lambda *_: None
    pipeline.asset_generator = MagicMock()

    def render(target, *_args, **_kwargs):
        target.image_asset = ImageAsset(variants=[ImageVariant(id="new", url="assets/new.png")])

    pipeline.asset_generator.generate_scene.side_effect = render
    _script, task_id = pipeline.create_asset_generation_task(
        "project", "street", "scene", prompt="Blue dusk street with pedestrians",
        negative_prompt="red sunset", model_name="model-a", aspect_ratio="16:9",
        apply_style=False, preserve_prompt=True,
    )
    scene.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "Red sunset"}})
    pipeline.generate_asset("project", "street", "scene", prompt="Blue dusk street with pedestrians",
                            negative_prompt="red sunset", model_name="model-a", aspect_ratio="16:9",
                            apply_style=False, preserve_prompt=True, _generation_task_id=task_id)

    restored = Script.model_validate(script.model_dump()).scenes[0].image_asset.variants[0]
    snapshot = restored.submission_snapshot
    assert snapshot.positive_prompt == "Blue dusk street with pedestrians"
    assert snapshot.negative_prompt == "red sunset"
    assert snapshot.selected_model_id == "model-a"
    assert snapshot.aspect_ratio == "16:9"
    assert snapshot.design_revision_at_submission == 1
    assert snapshot.reference_inputs == []


def test_series_prop_snapshot_survives_revision_change_and_keeps_existing_variant():
    from src.apps.comic_gen.models import Prop

    prop = Prop(id="food", name="Food", description="Food", asset_design={
        "design_revisions": [{"revision": 1, "design": {"visual_notes": "Plain bag"}}],
    }, image_asset=ImageAsset(variants=[ImageVariant(id="old", url="assets/old.png")]))
    series = Series(id="series", title="Series", created_at=1, updated_at=1, props=[prop])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.series_store = {series.id: series}
    pipeline.get_series = lambda *_: series
    pipeline.asset_generation_tasks = {}
    pipeline._save_lock = RLock()
    pipeline._save_series_data = MagicMock()
    pipeline.asset_generator = MagicMock()
    pipeline.asset_generator.generate_prop.side_effect = lambda target, *_args, **_kwargs: target.image_asset.variants.append(
        ImageVariant(id="new", url="assets/new.png")
    )

    _series, task_id = pipeline.generate_series_asset(
        "series", "food", "prop", prompt="Plain bag", negative_prompt="plastic",
        model_name="model-a", apply_style=False, preserve_prompt=True,
    )
    prop.asset_design["design_revisions"].append({"revision": 2, "design": {"visual_notes": "Golden bag"}})
    pipeline._process_series_asset_task(pipeline.asset_generation_tasks[task_id], pipeline.asset_generation_tasks[task_id]["params"])

    restored = Series.model_validate(series.model_dump()).props[0].image_asset.variants
    assert restored[0].submission_snapshot is None
    assert restored[1].submission_snapshot.positive_prompt == "Plain bag"
    assert restored[1].submission_snapshot.design_revision_at_submission == 1
    assert restored[1].submission_snapshot.reference_inputs == []


@pytest.mark.parametrize("generation_type", ["three_view", "headshot"])
def test_derived_character_requires_visible_master_variant(generation_type):
    request = GenerateAssetRequest(
        asset_id="person", asset_type="character", generation_type=generation_type,
        prompt="Reviewed prompt", apply_style=False, preserve_prompt=True,
    )
    with pytest.raises(HTTPException, match="Choose one explicit master image variant"):
        _require_reviewed_asset_image_prompt(request)


def test_series_character_text_generation_does_not_reuse_selected_reference():
    character = Character(id="person", name="Person", description="Person")
    series = Series(id="series", title="Series", created_at=1, updated_at=1, characters=[character])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.series_store = {series.id: series}
    pipeline.get_series = lambda *_: series
    pipeline.asset_generation_tasks = {}
    pipeline._save_lock = RLock()
    pipeline._save_series_data = MagicMock()
    pipeline.asset_generator = MagicMock()

    _series, task_id = pipeline.generate_series_asset(
        "series", "person", "character", generation_type="reference_sheet",
        prompt="Reviewed character sheet", apply_style=False, preserve_prompt=True,
    )
    task = pipeline.asset_generation_tasks[task_id]
    pipeline._process_series_asset_task(task, task["params"])

    call = pipeline.asset_generator.generate_character.call_args.kwargs
    assert call["use_reference_image"] is False
    assert call["i2i_model_name"] == series.model_settings.i2i_model


def test_submission_snapshot_records_only_stable_reference_identity():
    scene = Scene(id="street", name="Street", description="Street")
    snapshot = ComicGenPipeline._asset_submission_snapshot(
        scene, "scene", prompt="Blue street", negative_prompt="red",
        model_id="model-a", aspect_ratio="16:9", generation_type="all",
        image_generation_mode="reference",
        references=[{"asset_type": "scene", "asset_id": "background", "variant_id": "blue-1"}],
    )
    assert snapshot["reference_inputs"] == [{
        "asset_type": "scene", "asset_id": "background", "variant_id": "blue-1",
    }]
    assert "expires=" not in str(snapshot)
