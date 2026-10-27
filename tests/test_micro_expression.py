import pytest
from types import SimpleNamespace

from src.apps.comic_gen.micro_expression import (
    frame_static_expression_descriptions,
    opening_static_state,
    validate_micro_expression_payload,
    video_timing_description,
)


def payload(**overrides):
    candidate = {
        "character_id": "hero",
        "emotion_intent": "克制地意识到危险",
        "visibility": "close",
        "timing": [
            {"phase": "trigger", "relative_start": 0, "relative_end": 0.2, "visible_change": "视线短暂停住"},
            {"phase": "change", "relative_start": 0.2, "relative_end": 0.5, "visible_change": "眉心轻微收紧"},
            {"phase": "hold", "relative_start": 0.5, "relative_end": 0.8, "visible_change": "保持克制"},
            {"phase": "release", "relative_start": 0.8, "relative_end": 1, "visible_change": "视线恢复正前方"},
        ],
        "facial_channels": {"brows": "轻微收紧", "eyes_gaze": "短暂停住"},
        "body_invariant": "服装和站姿不变",
        "uncertainties": [],
        "source_refs": ["shot-1"],
    }
    candidate.update(overrides)
    return {"candidates": [candidate]}


def test_micro_expression_accepts_ordered_relative_timing():
    result = validate_micro_expression_payload(payload(), duration_seconds=6)
    assert opening_static_state(result[0]) == "视线短暂停住"
    assert "change(0.20-0.50)" in video_timing_description(result[0])


def test_static_frame_projection_uses_only_selected_boundary():
    accepted = {**payload(character_id="private-character-id")["candidates"][0], "character_name": "玄宸"}
    first = frame_static_expression_descriptions([accepted], "first")
    last = frame_static_expression_descriptions([accepted], "last")
    assert first == ["玄宸：视线短暂停住"]
    assert last == ["玄宸：视线恢复正前方"]
    assert "眉心轻微收紧" not in str(first + last)
    assert "private-character-id" not in str(first + last)


def test_frame_candidate_preview_binds_accepted_timing_and_slot():
    from unittest.mock import Mock
    from src.apps.comic_gen.models import Character, Script, StoryboardFrame
    from src.apps.comic_gen.pipeline import ComicGenPipeline

    frame = StoryboardFrame(id="frame", scene_id="", character_ids=["hero"])
    script = Script(id="film", title="T", original_text="", created_at=1, updated_at=1, frames=[frame])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"characters": [Character(id="hero", name="玄宸", description="克制")], "scenes": [], "props": []})

    before = pipeline.storyboard_candidate_preview_token("film", "frame", "草稿", None)
    frame.micro_expression_timing = [{**payload(character_id="hero")["candidates"][0], "character_name": "玄宸"}]
    assert pipeline.storyboard_candidate_preview_token("film", "frame", "草稿", None) != before

    first = pipeline.preview_storyboard_candidate_prompt("film", "frame", "草稿", slot="first")
    last = pipeline.preview_storyboard_candidate_prompt("film", "frame", "草稿", slot="last")
    assert "首帧静态表情：玄宸：视线短暂停住" in first
    assert "尾帧静态表情：玄宸：视线恢复正前方" in last
    assert "release" not in first and "trigger" not in last
    assert "眉心轻微收紧" not in first + last


@pytest.mark.parametrize("bad", [
    {"phase": "release", "relative_start": 0.2, "relative_end": 0.4, "visible_change": "x"},
    {"phase": "change", "relative_start": 0.2, "relative_end": 0.1, "visible_change": "x"},
])
def test_micro_expression_rejects_invalid_phase_order_or_range(bad):
    value = payload()
    value["candidates"][0]["timing"][1] = bad
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


@pytest.mark.parametrize("change", [
    lambda timing: timing[0].update(relative_start=0.1),
    lambda timing: timing[1].update(relative_start=0.1),
    lambda timing: timing.pop(0),
])
def test_micro_expression_requires_opening_state_and_nonoverlapping_phases(change):
    value = payload()
    change(value["candidates"][0]["timing"])
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


def test_micro_expression_rejects_unrelated_prompt_fields():
    value = payload()
    value["candidates"][0]["prompt"] = "重做整个场景"
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


def test_micro_expression_rejects_unknown_facial_channel():
    value = payload()
    value["candidates"][0]["facial_channels"]["lighting"] = "red"
    with pytest.raises(ValueError):
        validate_micro_expression_payload(value)


def test_micro_expression_api_review_input_excludes_neighbor_content(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.comic_gen.models import Script, StoryboardFrame

    frame_id = "e5a19270-1311-44c1-b162-a761002139aa"
    character_id = "f05e2031-73c7-463c-ae58-03e096ed41e0"
    frame = StoryboardFrame(id=frame_id, scene_id="scene", duration=6, shot_size="特写", character_ids=[character_id], dialogue="当前对白")
    other = StoryboardFrame(id="other", scene_id="scene", duration=6, character_ids=["villain"], dialogue="前镜对白")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1, frames=[other, frame])
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script))
    result = api._micro_expression_review("film", api.MicroExpressionTimingRequest(frame_id=frame_id), UserContext("o", "o", "", ""))
    encoded = str(result["input"])
    assert "前镜对白" not in encoded
    assert "当前对白" in encoded
    assert list(result["input"]["allowed_phases"]) == ["trigger", "change", "hold", "release"]
    assert result["input"]["characters"] == [{"ref": "character1", "name": "角色 1"}]
    assert frame_id not in str(result["messages"])
    assert character_id not in str(result["messages"])


def test_micro_expression_generate_requires_review_and_keeps_frame_fields(monkeypatch):
    import json
    from unittest.mock import Mock
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.comic_gen.models import Script, StoryboardFrame

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, character_ids=["hero"],
                            action_description="抬眼", dialogue="别动", shot_size="特写")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1, frames=[frame])
    response = payload(character_id="character1")
    response["candidates"][0]["uncertainties"] = ["角色锚点与面部可见性待确认"]
    llm = Mock(chat=Mock(return_value=json.dumps(response, ensure_ascii=False)))
    save = Mock()
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script,
                        script_processor=SimpleNamespace(llm=llm), _save_data=save))
    user = UserContext("o", "o", "", "")
    request = api.MicroExpressionTimingRequest(frame_id="frame")
    with pytest.raises(api.HTTPException) as unreviewed:
        api.generate_micro_expression("film", "frame", request, user)
    assert unreviewed.value.status_code == 409
    llm.chat.assert_not_called()

    review = api.preview_micro_expression("film", "frame", request, user)
    reviewed = request.model_copy(update={"review_token": review["review_token"], "reviewed_messages": review["messages"]})
    candidate = api.generate_micro_expression("film", "frame", reviewed, user)
    assert candidate["items"][0]["character_id"] == "hero"
    assert frame.action_description == "抬眼" and frame.dialogue == "别动"
    assert frame.micro_expression_timing == []
    assert llm.chat.call_args.kwargs["messages"][0]["role"] == "system"
    save.assert_called_once()


def test_micro_expression_generate_rejects_unknown_character_alias(monkeypatch):
    import json
    from unittest.mock import Mock
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.comic_gen.models import Script, StoryboardFrame

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, character_ids=["hero"])
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1, frames=[frame])
    llm = Mock(chat=Mock(return_value=json.dumps(payload(character_id="hero"))))
    save = Mock()
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script,
                        script_processor=SimpleNamespace(llm=llm), _save_data=save))
    user = UserContext("o", "o", "", "")
    request = api.MicroExpressionTimingRequest(frame_id="frame")
    review = api.preview_micro_expression("film", "frame", request, user)
    reviewed = request.model_copy(update={"review_token": review["review_token"], "reviewed_messages": review["messages"]})

    with pytest.raises(api.HTTPException) as rejected:
        api.generate_micro_expression("film", "frame", reviewed, user)
    assert rejected.value.status_code == 502
    assert frame.micro_expression_candidate is None
    save.assert_not_called()


def test_micro_expression_apply_rejects_changed_frame(monkeypatch):
    from unittest.mock import Mock
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.comic_gen.models import Script, StoryboardFrame

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, character_ids=["hero"], shot_size="特写")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1, frames=[frame])
    save = Mock()
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script, _save_data=save))
    user = UserContext("o", "o", "", "")
    review = api._micro_expression_review("film", api.MicroExpressionTimingRequest(frame_id="frame"), user)
    frame.micro_expression_candidate = {"id": "candidate", "source_hash": review["review_token"],
                                        "emotion_intent": "", "items": payload()["candidates"]}
    frame.shot_size = "远景"
    with pytest.raises(api.HTTPException) as stale:
        api.apply_micro_expression("film", "frame", api.MicroExpressionApplyRequest(
            candidate_id="candidate", character_ids=["hero"]), user)
    assert stale.value.status_code == 409
    assert frame.micro_expression_timing == []
    save.assert_not_called()


def test_micro_expression_apply_changes_only_selected_performance(monkeypatch):
    from unittest.mock import Mock
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.comic_gen.models import Script, StoryboardFrame

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, character_ids=["hero"],
                            shot_size="特写", action_description="抬眼", dialogue="别动")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1, frames=[frame])
    save = Mock()
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script, _save_data=save))
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    user = UserContext("o", "o", "", "")
    review = api._micro_expression_review("film", api.MicroExpressionTimingRequest(frame_id="frame"), user)
    frame.micro_expression_candidate = {"id": "candidate", "source_hash": review["review_token"],
                                        "emotion_intent": "", "visibility": "unknown", "items": payload()["candidates"]}
    original = frame.model_dump(exclude={"micro_expression_candidate", "micro_expression_timing", "updated_at"})

    api.apply_micro_expression("film", "frame", api.MicroExpressionApplyRequest(
        candidate_id="candidate", character_ids=["hero"]), user)

    assert frame.micro_expression_timing[0]["character_id"] == "hero"
    assert frame.micro_expression_candidate is None
    assert frame.model_dump(exclude={"micro_expression_candidate", "micro_expression_timing", "updated_at"}) == original
    save.assert_called_once()
