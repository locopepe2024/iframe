from pathlib import Path

import pytest

from src.apps.playground.models import GenerateRequest, PlaygroundDraft, PlaygroundGeneration, PlaygroundMode
from src.apps.playground.service import PlaygroundService
from src.apps.playground.storage import PlaygroundStorage


def make_storage(tmp_path: Path) -> PlaygroundStorage:
    return PlaygroundStorage(
        history_path=str(tmp_path / "history.json"),
        templates_path=str(tmp_path / "templates.json"),
        sessions_path=str(tmp_path / "sessions.json"),
    )


def test_sessions_keep_independent_generation_history(tmp_path: Path):
    storage = make_storage(tmp_path)
    service = PlaygroundService(storage)
    first = storage.create_session("第一版")
    second = storage.create_session("第二版")

    first_run = service.create_generation(GenerateRequest(mode=PlaygroundMode.T2I, model_id="image-a", prompt="red fox", session_id=first.id))
    second_run = service.create_generation(GenerateRequest(mode=PlaygroundMode.T2V, model_id="video-a", prompt="fox running", session_id=second.id))

    assert [item.id for item in storage.list_history(session_id=first.id)] == [first_run.id]
    assert [item.id for item in storage.list_history(session_id=second.id)] == [second_run.id]
    assert storage.get_session(first.id).draft.prompt == "red fox"
    assert storage.get_session(second.id).draft.prompt == "fox running"


def test_generation_records_edit_source(tmp_path: Path):
    storage = make_storage(tmp_path)
    service = PlaygroundService(storage)
    session = storage.create_session()
    root = service.create_generation(GenerateRequest(mode=PlaygroundMode.T2I, model_id="image-a", prompt="first", session_id=session.id))
    child = service.create_generation(GenerateRequest(mode=PlaygroundMode.I2I, model_id="image-a", prompt="refine", input_media=["source.png"], session_id=session.id, parent_generation_id=root.id))

    assert child.parent_generation_id == root.id
    assert storage.get_session(session.id).draft.parent_generation_id == child.id


def test_legacy_history_moves_into_history_session(tmp_path: Path):
    history_path = tmp_path / "history.json"
    legacy = PlaygroundGeneration(
        id="legacy-run",
        mode=PlaygroundMode.T2I,
        model_id="image-a",
        prompt="legacy prompt",
        created_at="2026-09-01T00:00:00+00:00",
    )
    history_path.write_text(f"[{legacy.model_dump_json()}]", encoding="utf-8")

    storage = make_storage(tmp_path)

    assert len(storage.list_sessions()) == 1
    session = storage.list_sessions()[0]
    assert session.title == "历史创作"
    assert storage.list_history(session_id=session.id)[0].id == "legacy-run"
    assert session.draft == PlaygroundDraft(mode=PlaygroundMode.T2I, model_id="image-a", prompt="legacy prompt", parent_generation_id="legacy-run")


def test_first_last_frame_requires_exactly_two_images():
    with pytest.raises(ValueError, match="exactly two images"):
        GenerateRequest(
            mode=PlaygroundMode.F2V,
            model_id="uniart/minimax-h3-vip",
            prompt="transition",
            input_media=["first.png"],
        )

    request = GenerateRequest(
        mode=PlaygroundMode.F2V,
        model_id="uniart/minimax-h3-vip",
        prompt="transition",
        input_media=["first.png", "last.png"],
    )
    assert request.input_media == ["first.png", "last.png"]
