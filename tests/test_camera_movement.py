import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.camera_movement import validate_movement_payload


def proposal():
    return {
        "camera_movement_structured": {"primary": "follow", "secondary": None, "speed": "normal", "description": "平稳跟随当前主体"},
        "rationale": "跟随当前动作",
        "source_refs": ["current_action"],
        "uncertainties": [],
    }


def setup_api(monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import Script, StoryboardFrame
    from src.apps.identity import UserContext

    frame = StoryboardFrame(id="frame", scene_id="scene", duration=6, action_description="向前走",
                            dialogue="当前对白", shot_size="中景", camera_angle="平视",
                            director_shot_context={"shot": {"camera_movement": "旧计划后拉", "visual_intent": "保持紧张"}})
    neighbor = StoryboardFrame(id="other", scene_id="scene", duration=6,
                               action_description="前镜挥刀", dialogue="前镜对白")
    script = Script(id="film", title="T", original_text="text", created_at=1, updated_at=1,
                    frames=[neighbor, frame])
    llm = Mock(chat=Mock(return_value=json.dumps(proposal(), ensure_ascii=False)))
    save = Mock()
    assets = Mock(return_value={"characters": []})
    monkeypatch.setattr(api, "pipeline", SimpleNamespace(get_script=lambda *_: script,
                        script_processor=SimpleNamespace(llm=llm), _save_data=save,
                        resolve_project_assets=assets))
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    return api, script, frame, llm, save, UserContext("o", "o", "", "")


def test_validator_rejects_unowned_fields():
    for update in ({"shot_size": "特写"}, {"prompt": "重写整镜"}):
        with pytest.raises(ValueError):
            validate_movement_payload({**proposal(), **update})
    bad = proposal()
    bad["camera_movement_structured"]["lighting"] = "red"
    with pytest.raises(ValueError):
        validate_movement_payload(bad)


def test_review_is_current_shot_only_and_generation_requires_review(monkeypatch):
    api, _, frame, llm, save, user = setup_api(monkeypatch)
    request = api.CameraMovementRequest(frame_id="frame")
    review = api.preview_camera_movement("film", "frame", request, user)
    assert "前镜挥刀" not in str(review["messages"])
    assert "前镜对白" not in str(review["messages"])
    assert "当前对白" not in str(review["messages"])
    assert review["input"]["current_action"] == "向前走"
    with pytest.raises(api.HTTPException) as unreviewed:
        api.generate_camera_movement("film", "frame", request, user)
    assert unreviewed.value.status_code == 409
    llm.chat.assert_not_called()
    assert frame.camera_movement_candidate is None
    save.assert_not_called()


def test_candidate_is_unapplied_and_apply_changes_only_movement(monkeypatch):
    api, script, frame, _, save, user = setup_api(monkeypatch)
    review = api.preview_camera_movement("film", "frame", api.CameraMovementRequest(frame_id="frame"), user)
    request = api.CameraMovementRequest(frame_id="frame", reviewed_messages=review["messages"],
                                        review_token=review["review_token"])
    before = frame.model_dump(exclude={"camera_movement_candidate", "camera_movement_structured", "assembled_prompt", "updated_at"})
    candidate = api.generate_camera_movement("film", "frame", request, user)
    assert frame.camera_movement_structured is None
    assert frame.assembled_prompt is None
    api.apply_camera_movement("film", "frame", api.CameraMovementApplyRequest(candidate_id=candidate["id"]), user)
    assert frame.camera_movement_structured.primary == "follow"
    assert "跟随" in frame.assembled_prompt
    assert "旧计划后拉" not in frame.assembled_prompt
    assert "保持紧张" in frame.assembled_prompt
    assert frame.camera_movement_candidate is None
    assert frame.model_dump(exclude={"camera_movement_candidate", "camera_movement_structured", "assembled_prompt", "updated_at"}) == before
    assert save.call_count == 2
    assert script.frames[-1] is frame


def test_stale_or_optimized_candidate_cannot_apply(monkeypatch):
    api, _, frame, _, save, user = setup_api(monkeypatch)
    review = api.preview_camera_movement("film", "frame", api.CameraMovementRequest(frame_id="frame"), user)
    frame.camera_movement_candidate = {"id": "candidate", "source_hash": review["review_token"], **proposal()}
    frame.shot_size = "特写"
    with pytest.raises(api.HTTPException) as stale:
        api.apply_camera_movement("film", "frame", api.CameraMovementApplyRequest(candidate_id="candidate"), user)
    assert stale.value.status_code == 409
    frame.shot_size = "中景"
    frame.workbench_prompt_is_optimized = True
    with pytest.raises(api.HTTPException) as optimized:
        api.apply_camera_movement("film", "frame", api.CameraMovementApplyRequest(candidate_id="candidate"), user)
    assert optimized.value.status_code == 409
    assert frame.camera_movement_structured is None
    save.assert_not_called()


def test_unknown_source_does_not_persist(monkeypatch):
    api, _, frame, llm, save, user = setup_api(monkeypatch)
    value = proposal()
    value["source_refs"] = ["neighbor_action"]
    llm.chat.return_value = json.dumps(value)
    review = api.preview_camera_movement("film", "frame", api.CameraMovementRequest(frame_id="frame"), user)
    request = api.CameraMovementRequest(frame_id="frame", reviewed_messages=review["messages"],
                                        review_token=review["review_token"])
    with pytest.raises(api.HTTPException) as invalid:
        api.generate_camera_movement("film", "frame", request, user)
    assert invalid.value.status_code == 502
    assert frame.camera_movement_candidate is None
    save.assert_not_called()
