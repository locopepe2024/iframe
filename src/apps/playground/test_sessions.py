from pathlib import Path

import pytest

from src.apps.playground.models import GenerateRequest, PlaygroundDraft, PlaygroundGeneration, PlaygroundMode
from src.apps.playground.service import PlaygroundService
from src.apps.playground.storage import PlaygroundStorage


def make_storage(tmp_path: Path) -> PlaygroundStorage:
    return PlaygroundStorage(
        owner_user_id="user-a",
        owner_profile_id="profile-a",
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


def test_library_studio_reference_resolves_before_generation_and_keeps_alias(tmp_path: Path, monkeypatch):
    from src.apps.studio_access import studio_media_url, studio_owner_dir
    from src.models.reference_binding import bind_reference_names

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-signing-key")
    image = Path(studio_owner_dir("profile-a")) / "assets" / "suyan.png"
    image.parent.mkdir(parents=True)
    image.write_bytes(b"image")
    stored = str(image.relative_to("output"))
    signed = studio_media_url("profile-a", stored)
    service = PlaygroundService(make_storage(tmp_path))

    generation = service.create_generation(GenerateRequest(
        mode=PlaygroundMode.I2I,
        model_id="uniart/image-model",
        prompt="@苏砚 持剑站立",
        input_media=[signed],
        media_names={signed.split("?", 1)[0]: "苏砚"},
    ))

    assert generation.input_media == [stored]
    assert generation.media_names == {stored: "苏砚"}
    assert bind_reference_names(generation.prompt, [generation.media_names[stored]]) == "@1 持剑站立"

    foreign_image = Path(studio_owner_dir("another-profile")) / "assets" / "foreign.png"
    foreign_image.parent.mkdir(parents=True)
    foreign_image.write_bytes(b"other image")
    foreign_signed = studio_media_url("another-profile", str(foreign_image.relative_to("output")))
    with pytest.raises(ValueError, match="another owner"):
        service.create_generation(GenerateRequest(
            mode=PlaygroundMode.I2I,
            model_id="uniart/image-model",
            prompt="unrelated",
            input_media=[foreign_signed],
        ))


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
    assert session.owner_profile_id == "profile-a"
    assert storage.list_history(session_id=session.id)[0].owner_profile_id == "profile-a"


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


def test_delete_session_removes_only_its_history_and_persists(tmp_path):
    storage = make_storage(tmp_path)
    service = PlaygroundService(storage)
    first = storage.create_session('first')
    second = storage.create_session('second')
    run = service.create_generation(GenerateRequest(mode=PlaygroundMode.T2I, model_id='test', prompt='test', session_id=first.id))
    with pytest.raises(ValueError, match='active'):
        storage.delete_session(first.id)
    assert storage.get_session(first.id)
    run.status = 'completed'
    storage.update_generation(run)
    assert storage.delete_session(first.id)
    restored = make_storage(tmp_path)
    assert restored.get_session(first.id) is None
    assert restored.get_generation(run.id) is None
    assert restored.get_session(second.id)
    assert not restored.delete_session('missing')


def test_h3_video_submission_uses_canonical_prompt_without_model_name_error(tmp_path, monkeypatch):
    storage = make_storage(tmp_path)
    service = PlaygroundService(storage)
    service._load_provider_config = lambda: {"base_url": "https://uniart.test", "api_key": "test"}
    captured = {}

    class FakeUniArtVideoModel:
        def __init__(self, _config):
            pass

        def generate(self, prompt, output_path, **kwargs):
            captured["prompt"] = prompt
            kwargs["on_task_submitted"]("upstream-task")
            return output_path, 0.0

    monkeypatch.setattr("src.models.uniart.UniArtVideoModel", FakeUniArtVideoModel)
    monkeypatch.setattr("src.models.mulerouter.MuleRouterVideoModel", FakeUniArtVideoModel)

    generation = PlaygroundGeneration(
        id="h3-generation",
        owner_user_id="user-a",
        owner_profile_id="profile-a",
        mode=PlaygroundMode.R2V,
        model_id="uniart/minimax-h3-vip",
        prompt="@identity.jpg is the subject; @motion.mp4 supplies motion.",
        input_media=["/tmp/identity.jpg", "/tmp/motion.mp4"],
        media_names={"/tmp/identity.jpg": "identity.jpg", "/tmp/motion.mp4": "motion.mp4"},
        parameters={"resolution": "720p", "duration": 15},
        created_at="2026-10-03T00:00:00+00:00",
    )

    service._generate_video_mulerouter(generation, str(tmp_path / "result.mp4"))

    assert captured["prompt"] == "<Picture 1> is the subject; <Video 1> supplies motion."
    assert generation.provider_tasks == {"0": "upstream-task"}
