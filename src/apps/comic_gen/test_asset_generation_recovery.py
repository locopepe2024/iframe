import threading

from src.apps.comic_gen.models import Character, GenerationStatus, GlobalAssetLibrary, Script
from src.apps.comic_gen.pipeline import ComicGenPipeline


def _pipeline_with_processing_character():
    character = Character(id="char-1", name="Test", description="Test", status=GenerationStatus.PROCESSING)
    project = Script(id="project-1", title="Test", original_text="text", characters=[character], created_at=0, updated_at=0)
    pipeline = object.__new__(ComicGenPipeline)
    pipeline.scripts = {project.id: project}
    pipeline.series_store = {}
    pipeline.library_store = GlobalAssetLibrary()
    pipeline._save_lock = threading.RLock()
    pipeline._save_data = lambda: None
    pipeline._save_series_data = lambda: None
    pipeline._save_library_data = lambda: None
    return pipeline, project, character


def test_restart_marks_processing_image_asset_as_recoverable_failure():
    pipeline, _project, character = _pipeline_with_processing_character()

    pipeline._recover_orphan_asset_states()

    assert character.status == GenerationStatus.FAILED
    assert "backend restart" in (character.generation_error or "")


def test_clear_generation_state_preserves_asset_and_resets_status():
    pipeline, project, character = _pipeline_with_processing_character()
    character.status = GenerationStatus.FAILED
    character.generation_error = "provider timeout"

    updated = pipeline.clear_asset_generation_state(project.id, character.id, "character")

    assert updated is project
    assert character.status == GenerationStatus.PENDING
    assert character.generation_error is None
