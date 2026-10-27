import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.static_framing import validate_static_framing_payload


def proposal():
    return {
        "fields": {"shot_size": "近景", "composition": "主体位于画面左侧"},
        "rationale": {"shot_size": "观察表情起态", "composition": "保留右侧空间"},
        "source_refs": {"shot_size": ["current_action"], "composition": ["blocking"]},
        "uncertainties": [],
    }


def setup_api(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import Script, StoryboardFrame
    from src.apps.identity import UserContext

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, action_description="停步抬眼",
                            shot_size="中景", camera_angle="平视", composition="两人分立画面两侧",
                            director_shot_context={"shot": {"composition": "旧计划居中", "visual_intent": "保持警觉"}})
    other = StoryboardFrame(id="other", scene_id="scene", action_description="前镜挥刀", dialogue="前镜对白")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1,
                    frames=[other, frame])
    llm = Mock(chat=Mock(return_value=json.dumps(proposal(), ensure_ascii=False)))
    save = Mock()
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script,
                        script_processor=SimpleNamespace(llm=llm), _save_data=save,
                        resolve_project_assets=Mock(return_value={"characters": []})))
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    return api, frame, llm, save, UserContext("o", "o", "", "")


def test_validator_rejects_unknown_or_incomplete_fields():
    with pytest.raises(ValueError):
        validate_static_framing_payload({**proposal(), "camera_movement": "push_in"})
    bad = proposal()
    bad["fields"]["lighting"] = "暖光"
    with pytest.raises(ValueError):
        validate_static_framing_payload(bad)
    bad = proposal()
    bad["rationale"].pop("composition")
    with pytest.raises(ValueError):
        validate_static_framing_payload(bad)


def test_preview_excludes_neighbor_content_and_requires_review(monkeypatch):
    api, frame, llm, save, user = setup_api(monkeypatch)
    request = api.StaticFramingRequest(frame_id="frame")
    review = api.preview_static_framing("film", "frame", request, user)
    assert "前镜挥刀" not in str(review["messages"])
    assert "前镜对白" not in str(review["messages"])
    assert review["input"]["current_action"] == "停步抬眼"
    with pytest.raises(api.HTTPException) as unreviewed:
        api.generate_static_framing("film", "frame", request, user)
    assert unreviewed.value.status_code == 409
    llm.chat.assert_not_called()
    assert frame.static_framing_candidate is None
    save.assert_not_called()


def test_apply_only_selected_field_and_uses_new_composition(monkeypatch):
    api, frame, _, save, user = setup_api(monkeypatch)
    review = api.preview_static_framing("film", "frame", api.StaticFramingRequest(frame_id="frame"), user)
    request = api.StaticFramingRequest(frame_id="frame", reviewed_messages=review["messages"],
                                       review_token=review["review_token"])
    original = frame.model_dump(exclude={"static_framing_candidate", "composition", "assembled_prompt", "updated_at"})
    candidate = api.generate_static_framing("film", "frame", request, user)
    assert frame.composition == "两人分立画面两侧"
    assert frame.assembled_prompt is None
    api.apply_static_framing("film", "frame", api.StaticFramingApplyRequest(
        candidate_id=candidate["id"], selected_fields=["composition"]), user)
    assert frame.composition == "主体位于画面左侧"
    assert frame.shot_size == "中景"
    assert "构图：主体位于画面左侧" in frame.assembled_prompt
    assert "旧计划居中" not in frame.assembled_prompt
    assert frame.model_dump(exclude={"static_framing_candidate", "composition", "assembled_prompt", "updated_at"}) == original
    assert save.call_count == 2


def test_stale_and_optimized_candidate_rejected(monkeypatch):
    api, frame, _, save, user = setup_api(monkeypatch)
    review = api.preview_static_framing("film", "frame", api.StaticFramingRequest(frame_id="frame"), user)
    frame.static_framing_candidate = {"id": "candidate", "source_hash": review["review_token"], **proposal()}
    frame.camera_angle = "俯视"
    with pytest.raises(api.HTTPException) as stale:
        api.apply_static_framing("film", "frame", api.StaticFramingApplyRequest(
            candidate_id="candidate", selected_fields=["composition"]), user)
    assert stale.value.status_code == 409
    frame.camera_angle = "平视"
    frame.workbench_prompt_is_optimized = True
    with pytest.raises(api.HTTPException) as optimized:
        api.apply_static_framing("film", "frame", api.StaticFramingApplyRequest(
            candidate_id="candidate", selected_fields=["composition"]), user)
    assert optimized.value.status_code == 409
    save.assert_not_called()


def test_unknown_source_does_not_persist(monkeypatch):
    api, frame, llm, save, user = setup_api(monkeypatch)
    value = proposal()
    value["source_refs"]["composition"] = ["neighbor_action"]
    llm.chat.return_value = json.dumps(value)
    review = api.preview_static_framing("film", "frame", api.StaticFramingRequest(frame_id="frame"), user)
    request = api.StaticFramingRequest(frame_id="frame", reviewed_messages=review["messages"],
                                       review_token=review["review_token"])
    with pytest.raises(api.HTTPException) as invalid:
        api.generate_static_framing("film", "frame", request, user)
    assert invalid.value.status_code == 502
    assert frame.static_framing_candidate is None
    save.assert_not_called()
