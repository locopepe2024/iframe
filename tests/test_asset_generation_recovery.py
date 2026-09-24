"""Recovery behavior for Studio character/scene/prop image tasks."""

import time
from unittest.mock import patch

import pytest

from src.apps.comic_gen.models import (
    AssetUnit,
    AssetGenerationTaskState,
    Character,
    GenerationStatus,
    ImageAsset,
    ImageVariant,
    Prop,
    Script,
    Scene,
)
from src.apps.comic_gen.pipeline import ComicGenPipeline


@pytest.fixture
def pipeline(tmp_path):
    with patch("src.apps.comic_gen.pipeline.ScriptProcessor"), \
         patch("src.apps.comic_gen.pipeline.AssetGenerator"), \
         patch("src.apps.comic_gen.pipeline.StoryboardGenerator"), \
         patch("src.apps.comic_gen.pipeline.VideoGenerator"), \
         patch("src.apps.comic_gen.pipeline.AudioGenerator"), \
         patch("src.apps.comic_gen.pipeline.ExportManager"):
        instance = ComicGenPipeline()
    instance.data_file = str(tmp_path / "projects.json")
    instance.series_data_file = str(tmp_path / "series.json")
    instance.library_data_file = str(tmp_path / "library_assets.json")
    instance.scripts = {}
    instance.series_store = {}
    return instance


def _project(asset):
    return Script(
        id="project-1",
        title="Recovery",
        original_text="text",
        created_at=time.time(),
        updated_at=time.time(),
        characters=[asset] if isinstance(asset, Character) else [],
        scenes=[asset] if isinstance(asset, Scene) else [],
        props=[asset] if isinstance(asset, Prop) else [],
    )


def _character(*, status=GenerationStatus.PENDING, selected="v1"):
    return Character(
        id="character-1",
        name="Character",
        description="A test character",
        status=status,
        reference_sheet=AssetUnit(
            selected_image_id=selected,
            image_variants=[ImageVariant(id="v1", url="assets/v1.png")],
        ),
    )


def test_restart_recovers_processing_asset_task_and_keeps_partial_asset(pipeline):
    asset = _character(status=GenerationStatus.PROCESSING)
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    asset.generation_task = AssetGenerationTaskState(
        task_id="asset-task-1",
        status="processing",
        created_at=time.time(),
        script_id=project.id,
        asset_id=asset.id,
        asset_type="character",
        asset_source="script",
    )
    pipeline._save_data()

    # Simulate a new process: task memory is empty, but the project snapshot is durable.
    pipeline.asset_generation_tasks = {}
    pipeline.scripts = pipeline._load_data()
    asset = pipeline.scripts[project.id].characters[0]
    pipeline._recover_orphan_tasks()

    assert asset.status == GenerationStatus.FAILED
    assert asset.generation_task.status == "failed"
    assert "Backend was restarted" in asset.generation_task.error
    assert [variant.id for variant in asset.reference_sheet.image_variants] == ["v1"]
    recovered = pipeline.get_asset_generation_task_status("asset-task-1")
    assert recovered["status"] == "failed"
    assert recovered["asset"]["reference_sheet"]["image_variants"][0]["id"] == "v1"
    assert recovered["asset_index_state"] == "valid"
    assert pipeline._load_data()[project.id].characters[0].generation_task.status == "failed"


def test_provider_timeout_is_persisted_as_failed_with_partial_snapshot(pipeline):
    asset = _character()
    project = _project(asset)
    pipeline.scripts = {project.id: project}

    _, task_id = pipeline.create_asset_generation_task(
        project.id, asset.id, "character", generation_type="reference_sheet"
    )

    def timeout(*_args, **_kwargs):
        asset.reference_sheet.image_variants.append(
            ImageVariant(id="partial-from-this-task", url="assets/partial.png")
        )
        raise TimeoutError("Provider request timed out")

    pipeline.generate_asset = timeout
    pipeline.process_asset_generation_task(task_id)

    status = pipeline.get_asset_generation_task_status(task_id)
    assert status["status"] == "failed"
    assert status["error"] == "Provider request timed out"
    assert asset.status == GenerationStatus.FAILED
    assert [variant["id"] for variant in status["asset"]["reference_sheet"]["image_variants"]] == [
        "v1", "partial-from-this-task"
    ]


def test_successful_task_does_not_claim_asset_ready_when_selected_index_is_stale(pipeline):
    asset = _character(status=GenerationStatus.PENDING, selected="missing")
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    _, task_id = pipeline.create_asset_generation_task(
        project.id, asset.id, "character", generation_type="reference_sheet"
    )
    pipeline.generate_asset = lambda *_args, **_kwargs: None

    pipeline.process_asset_generation_task(task_id)

    status = pipeline.get_asset_generation_task_status(task_id)
    assert status["status"] == "completed"
    assert status["asset_index_state"] == "stale"
    assert asset.generation_task.status == "completed"
    assert asset.status == GenerationStatus.PENDING


@pytest.mark.parametrize(
    ("selected", "expected_status", "expected_index"),
    [
        ("v1", GenerationStatus.COMPLETED, "valid"),
        ("missing", GenerationStatus.PENDING, "stale"),
        (None, GenerationStatus.PENDING, "empty"),
    ],
)
def test_clear_marks_task_cleared_and_preserves_variants(
    pipeline, selected, expected_status, expected_index
):
    asset = _character(status=GenerationStatus.FAILED, selected=selected)
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    asset.generation_task = AssetGenerationTaskState(
        task_id="failed-task",
        status="failed",
        error="provider error",
        created_at=time.time(),
    )

    result = pipeline.clear_asset_generation_status(
        project.id, "character", asset.id
    )

    assert asset.status == expected_status
    assert asset.generation_task.status == "cleared"
    assert asset.generation_task.error is None
    assert result["asset_index_state"] == expected_index
    assert [variant.id for variant in asset.reference_sheet.image_variants] == ["v1"]


def test_clear_rejects_an_active_worker(pipeline):
    asset = _character(status=GenerationStatus.PROCESSING)
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    asset.generation_task = AssetGenerationTaskState(
        task_id="active-task",
        status="processing",
        created_at=time.time(),
    )
    pipeline.asset_generation_tasks = {
        "active-task": {
            "status": "processing",
            "script_id": project.id,
            "asset_id": asset.id,
            "asset_type": "character",
        }
    }
    pipeline._active_asset_generation_tasks.add("active-task")

    with pytest.raises(ValueError, match="active"):
        pipeline.clear_asset_generation_status(project.id, "character", asset.id)

    assert asset.generation_task.status == "processing"
    assert asset.status == GenerationStatus.PROCESSING


def test_clear_of_a_queued_task_prevents_its_worker_from_starting(pipeline):
    asset = _character()
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    _, task_id = pipeline.create_asset_generation_task(
        project.id, asset.id, "character", generation_type="reference_sheet"
    )

    pipeline.clear_asset_generation_status(project.id, "character", asset.id)
    pipeline.process_asset_generation_task(task_id)

    assert pipeline.asset_generation_tasks[task_id]["status"] == "cleared"
    assert asset.status == GenerationStatus.COMPLETED
    pipeline.asset_generator.generate_character.assert_not_called()


@pytest.mark.parametrize("asset_type", ["scene", "prop"])
def test_clear_restores_scene_and_prop_from_their_selected_variant(pipeline, asset_type):
    asset_model = Scene if asset_type == "scene" else Prop
    asset = asset_model(
        id=f"{asset_type}-1",
        name=asset_type,
        description="Test asset",
        status=GenerationStatus.FAILED,
        image_asset=ImageAsset(
            selected_id="variant-1",
            variants=[ImageVariant(id="variant-1", url="assets/variant.png")],
        ),
    )
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    asset.generation_task = AssetGenerationTaskState(
        task_id="failed-image-task",
        status="failed",
        script_id=project.id,
        asset_id=asset.id,
        asset_type=asset_type,
        asset_source="script",
    )

    result = pipeline.clear_asset_generation_status(project.id, asset_type, asset.id)

    assert asset.status == GenerationStatus.COMPLETED
    assert result["asset_index_state"] == "valid"
    assert result["asset"]["image_asset"]["variants"][0]["id"] == "variant-1"


def test_retry_uses_a_new_task_id_after_manual_clear(pipeline):
    asset = _character(status=GenerationStatus.FAILED)
    project = _project(asset)
    pipeline.scripts = {project.id: project}
    asset.generation_task = AssetGenerationTaskState(
        task_id="old-task",
        status="failed",
        script_id=project.id,
        asset_id=asset.id,
        asset_type="character",
        asset_source="script",
    )
    pipeline.asset_generation_tasks["old-task"] = {
        "status": "failed",
        "script_id": project.id,
        "asset_id": asset.id,
        "asset_type": "character",
    }

    pipeline.clear_asset_generation_status(project.id, "character", asset.id)
    _, new_task_id = pipeline.create_asset_generation_task(
        project.id, asset.id, "character", generation_type="reference_sheet"
    )

    assert new_task_id != "old-task"
    assert asset.generation_task.task_id == new_task_id
    assert pipeline.get_asset_generation_task_status("old-task") is None


def test_orphan_recovery_fails_legacy_processing_but_keeps_never_started_assets_pending(pipeline):
    stuck = _character(status=GenerationStatus.PROCESSING)
    never_started = Character(id="new", name="New", description="No image")
    project = _project(stuck)
    project.characters.append(never_started)
    pipeline.scripts = {project.id: project}

    pipeline._recover_orphan_tasks()

    assert stuck.status == GenerationStatus.FAILED
    assert never_started.status == GenerationStatus.PENDING


def test_task_status_endpoint_signs_failed_partial_asset_without_project_reload(monkeypatch):
    from src.apps.comic_gen import api

    status = {
        "task_id": "failed-task",
        "status": "failed",
        "asset_id": "character-1",
        "asset_type": "character",
        "asset": {"id": "character-1", "status": "failed"},
        "asset_index_state": "stale",
    }
    monkeypatch.setattr(api.pipeline, "get_asset_generation_task_status", lambda _id: status)
    monkeypatch.setattr(api.pipeline, "get_script", lambda _id: pytest.fail("must not reload project"))
    signed = []
    monkeypatch.setattr(api, "signed_response", lambda value: signed.append(value) or value)

    assert api.get_task_status("failed-task") == status
    assert signed == [status]


def test_clear_generation_route_returns_target_snapshot(monkeypatch):
    from src.apps.comic_gen import api

    expected = {"status": "cleared", "asset": {"id": "character-1"}}
    monkeypatch.setattr(
        api.pipeline,
        "clear_asset_generation_status",
        lambda project_id, asset_type, asset_id: expected,
    )
    monkeypatch.setattr(api, "signed_response", lambda value: value)

    assert api.clear_asset_generation_status("project-1", "character", "character-1") == expected


def test_clear_generation_route_returns_conflict_for_running_worker(monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    from src.apps.comic_gen.pipeline import ActiveAssetGenerationError

    monkeypatch.setattr(
        api.pipeline,
        "clear_asset_generation_status",
        lambda *_args: (_ for _ in ()).throw(ActiveAssetGenerationError("active")),
    )
    with pytest.raises(HTTPException) as error:
        api.clear_asset_generation_status("project-1", "character", "character-1")
    assert error.value.status_code == 409
