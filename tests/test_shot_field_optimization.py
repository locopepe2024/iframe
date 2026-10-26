import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api
from src.apps.comic_gen.models import Scene, Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.shot_field_optimization import validate_shot_field_payload
from src.apps.comic_gen.camera_movement_input import movement_from_editor


def fixture_pipeline(monkeypatch):
    scene = Scene(id="street", name="长街", description="青石街")
    scene.asset_design = {"design_revisions": [{"revision": 2, "design": {
        "style": "写实电影", "ambient_lighting": "暮秋残阳",
    }}]}
    frame = StoryboardFrame(id="shot", scene_id="street", action_description="商贩穿行",
                             shot_size="大远景", camera_angle="鸟瞰", duration=6,
                             director_shot_context={"scene": {"place_continuity_id": "street",
                                                               "time_continuity_id": "dusk"}})
    following = StoryboardFrame(id="following", scene_id="street", action_description="下一镜隐秘动作",
                                dialogue="下一镜对白", director_shot_context={"scene": {
                                    "place_continuity_id": "street", "time_continuity_id": "dusk"}})
    script = Script(id="project", title="Project", original_text="", scenes=[scene], frames=[frame, following],
                    created_at=1, updated_at=1)
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.get_script = Mock(return_value=script)
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"scenes": [scene], "characters": [], "props": []})
    pipeline.script_processor = Mock()
    pipeline._save_data = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    return pipeline, script, scene, frame


def test_shot_field_review_uses_confirmed_scene_and_current_shot_only(monkeypatch):
    pipeline, _, _, frame = fixture_pipeline(monkeypatch)
    user = SimpleNamespace(owner_profile_id="owner")
    review = api._shot_field_review("project", "shot", user)
    payload = review["input"]
    assert payload["effective_visual"]["style"] == {"value": "写实电影", "source": "scene_design", "revision": 2}
    assert payload["effective_visual"]["ambient_lighting"]["value"] == "暮秋残阳"
    assert payload["fields"]["shot_size"] == "大远景"
    assert payload["next_shot"]["relationship"] == "same_place_time"
    assert "下一镜隐秘动作" not in review["messages"]["user"]
    assert "下一镜对白" not in review["messages"]["user"]
    frame.action_description = "江湖客止步"
    assert api._shot_field_review("project", "shot", user)["review_token"] != review["review_token"]


def test_shot_field_review_accepts_legacy_movement_dict(monkeypatch):
    _, _, _, frame = fixture_pipeline(monkeypatch)
    frame.camera_movement_structured = {"primary": "static", "description": "固定机位"}
    review = api._shot_field_review("project", "shot", SimpleNamespace(owner_profile_id="owner"))
    assert review["input"]["fields"]["camera_movement_structured"]["primary"] == "static"


def test_shot_field_candidate_requires_evidence_and_applies_only_selected(monkeypatch):
    pipeline, _, _, frame = fixture_pipeline(monkeypatch)
    user = SimpleNamespace(owner_profile_id="owner")
    review = api._shot_field_review("project", "shot", user)
    proposal = {"fields": {"duration": 8, "transition_hint": "硬切"},
                "rationale": {"duration": "本镜人群穿行需八秒", "transition_hint": "当前镜头结束后切到下镜"},
                "source_refs": {"duration": ["current_action"], "transition_hint": ["fields.shot_size"]},
                "uncertainties": []}
    pipeline.script_processor.llm.chat.return_value = json.dumps(proposal, ensure_ascii=False)
    request = api.ShotFieldRequest(frame_id="shot", reviewed_messages=review["messages"], review_token=review["review_token"])
    candidate = api.generate_shot_fields("project", "shot", request, user)
    assert frame.duration == 6 and frame.transition_hint is None
    api.apply_shot_fields("project", "shot", api.ShotFieldApplyRequest(
        candidate_id=candidate["id"], selected_fields=["transition_hint"]), user)
    assert frame.duration == 6 and frame.transition_hint == "硬切"
    assert frame.shot_field_candidate is None


def test_shot_field_candidate_rejects_missing_reason_and_stale_scene(monkeypatch):
    pipeline, _, scene, frame = fixture_pipeline(monkeypatch)
    user = SimpleNamespace(owner_profile_id="owner")
    review = api._shot_field_review("project", "shot", user)
    proposal = {"fields": {"duration": 8}, "rationale": {}, "source_refs": {"duration": ["current_action"]}}
    with pytest.raises(ValueError):
        validate_shot_field_payload(proposal)
    proposal["rationale"] = {"duration": "本镜人群穿行需八秒"}
    pipeline.script_processor.llm.chat.return_value = json.dumps(proposal, ensure_ascii=False)
    candidate = api.generate_shot_fields("project", "shot", api.ShotFieldRequest(
        frame_id="shot", reviewed_messages=review["messages"], review_token=review["review_token"]), user)
    scene.asset_design["design_revisions"].append({"revision": 3, "design": {"style": "水墨"}})
    with pytest.raises(HTTPException) as exc:
        api.apply_shot_fields("project", "shot", api.ShotFieldApplyRequest(
            candidate_id=candidate["id"], selected_fields=["duration"]), user)
    assert exc.value.status_code == 409
    assert frame.duration == 6


def test_no_warranted_field_change_does_not_persist_candidate(monkeypatch):
    pipeline, _, _, frame = fixture_pipeline(monkeypatch)
    user = SimpleNamespace(owner_profile_id="owner")
    review = api._shot_field_review("project", "shot", user)
    pipeline.script_processor.llm.chat.return_value = json.dumps({
        "fields": {}, "rationale": {}, "source_refs": {}, "uncertainties": [],
    })
    result = api.generate_shot_fields("project", "shot", api.ShotFieldRequest(
        frame_id="shot", reviewed_messages=review["messages"], review_token=review["review_token"]), user)
    assert result["fields"] == {}
    assert frame.shot_field_candidate is None
    pipeline._save_data.assert_not_called()


def test_video_polish_preview_contains_effective_scene_style_and_light(monkeypatch):
    fixture_pipeline(monkeypatch)
    user = SimpleNamespace(owner_profile_id="owner")
    monkeypatch.setattr(api, "current_studio_user", lambda: user)
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "")
    preview = api._compile_video_polish_review(api.PolishVideoPromptRequest(
        draft_prompt="商贩穿行", script_id="project", frame_id="shot",
        target_video_model="uniart/minimax-h3-vip", optimization_skills=[],
    ), False)
    system = preview["messages"]["system"]
    assert preview["review_context"]["effective_shot_fields"]["ambient_lighting"] == {
        "value": "暮秋残阳", "source": "scene_design", "revision": 2,
    }
    assert '"style": {"revision": 2, "source": "scene_design", "value": "写实电影"}' in system
    assert '"ambient_lighting": {"revision": 2, "source": "scene_design", "value": "暮秋残阳"}' in system


def test_new_full_prompt_warns_but_allows_changed_scene_before_video_task(monkeypatch):
    pipeline, script, scene, frame = fixture_pipeline(monkeypatch)
    pipeline.update_frame(script.id, frame.id, action_description="H3 完整稿", workbench_prompt_is_optimized=True)
    assert frame.workbench_visual_source_hash == pipeline._workbench_visual_source_hash(script, frame)
    scene.asset_design["design_revisions"].append({"revision": 3, "design": {
        "style": "水墨", "ambient_lighting": "清晨冷光",
    }})
    updated, task_id = pipeline.create_video_task(script.id, "", "old optimized prompt", frame_id=frame.id)
    task = next(item for item in updated.video_tasks if item.id == task_id)
    assert task.warning and "旧版镜头字段" in task.warning


def test_video_submission_rejects_visual_change_after_preview(monkeypatch):
    from fastapi import BackgroundTasks

    pipeline, script, scene, frame = fixture_pipeline(monkeypatch)
    preview_hash = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]["visual_source_hash"]
    scene.asset_design["design_revisions"].append({"revision": 3, "design": {
        "style": "水墨", "ambient_lighting": "清晨冷光",
    }})
    request = api.CreateVideoTaskRequest(
        image_url="", prompt="旧预览", frame_id=frame.id,
        visual_source_hash=preview_hash,
    )
    with pytest.raises(HTTPException) as exc:
        api.create_video_task(script.id, request, BackgroundTasks())
    assert exc.value.status_code == 409
    assert not script.video_tasks


def test_video_submission_rejects_changed_reference_selection_after_preview(monkeypatch):
    from fastapi import BackgroundTasks

    pipeline, script, _, frame = fixture_pipeline(monkeypatch)
    preview_hash = pipeline.storyboard_continuity_sheet(script.id)["rows"][0]["visual_source_hash"]
    frame.workbench_reference_variant_ids = {"street": ["new-scene-variant"]}
    request = api.CreateVideoTaskRequest(
        image_url="", prompt="旧预览", frame_id=frame.id,
        visual_source_hash=preview_hash,
    )
    with pytest.raises(HTTPException) as exc:
        api.create_video_task(script.id, request, BackgroundTasks())
    assert exc.value.status_code == 409
    assert not script.video_tasks


def test_new_full_prompt_warns_but_allows_changed_camera_field_before_video_task(monkeypatch):
    pipeline, script, _, frame = fixture_pipeline(monkeypatch)
    pipeline.update_frame(script.id, frame.id, action_description="H3 完整稿", workbench_prompt_is_optimized=True)
    pipeline.update_frame(script.id, frame.id, camera_angle="平视")
    updated, task_id = pipeline.create_video_task(script.id, "", "old optimized prompt", frame_id=frame.id)
    task = next(item for item in updated.video_tasks if item.id == task_id)
    assert task.warning and "旧版镜头字段" in task.warning


def test_new_full_prompt_warns_but_allows_changed_duration_before_video_task(monkeypatch):
    pipeline, script, _, frame = fixture_pipeline(monkeypatch)
    pipeline.update_frame(script.id, frame.id, action_description="H3 完整稿", workbench_prompt_is_optimized=True)
    pipeline.update_frame(script.id, frame.id, duration=4)
    updated, task_id = pipeline.create_video_task(script.id, "", "old optimized prompt", duration=4, frame_id=frame.id)
    task = next(item for item in updated.video_tasks if item.id == task_id)
    assert task.duration == 4
    assert task.warning and "旧版镜头字段" in task.warning


def test_new_full_prompt_warns_but_allows_changed_reference_projection_before_video_task(monkeypatch):
    from src.apps.comic_gen.models import StoryboardReferenceProjectionSnapshot

    pipeline, script, _, frame = fixture_pipeline(monkeypatch)
    pipeline.update_frame(script.id, frame.id, action_description="H3 完整稿", workbench_prompt_is_optimized=True)
    frame.reference_visual_projection = StoryboardReferenceProjectionSnapshot(
        target_frame_id=frame.id, target_scene_id=frame.scene_id,
        source_variant_id="v2", selected_fields=["lighting"],
        visual_design={"lighting": {"shadow_direction": "左前方"}},
    )
    updated, task_id = pipeline.create_video_task(script.id, "", "old optimized prompt", frame_id=frame.id)
    task = next(item for item in updated.video_tasks if item.id == task_id)
    assert task.warning and "旧版镜头字段" in task.warning


def test_manual_movement_preset_and_custom_keep_distinct_type_and_description():
    preset = movement_from_editor("缓慢推进")
    assert preset.primary == "push_in" and preset.speed == "slow" and preset.description == "缓慢推进"
    custom = movement_from_editor("沿青石街缓缓横移")
    assert custom.primary == "custom" and custom.description == "沿青石街缓缓横移"
