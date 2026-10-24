from unittest.mock import Mock
import pytest

from src.apps.comic_gen.pipeline import ComicGenPipeline
from src.apps.comic_gen.models import Blocking, Script, StageSubject, StoryboardFrame


def test_style_edit_updates_adopted_video_and_image_prompts_in_one_save():
    pipeline = object.__new__(ComicGenPipeline)
    frame = StoryboardFrame(id="frame", scene_id="room", action_description="detailed_description: old light; action\noverall_soundscape: N/A",
        workbench_prompt_is_optimized=True, lighting_override="old light", image_prompt_en="Image old light", image_prompt="Image old light")
    script = Script(id="project", title="Test", original_text="", created_at=0, updated_at=0, frames=[frame])
    pipeline.scripts = {script.id: script}
    pipeline._save_data = Mock()
    pipeline.update_frame(script.id, frame.id, lighting_override="new light")
    assert "new light" in frame.action_description
    assert "old light" not in frame.action_description
    assert "new light" in frame.image_prompt_en
    assert frame.image_prompt == frame.image_prompt_en
    assert frame.workbench_prompt_is_optimized
    pipeline._save_data.assert_called_once()


def test_explicit_visible_body_and_optimized_flag_are_saved_together():
    pipeline = object.__new__(ComicGenPipeline)
    frame = StoryboardFrame(id="frame", scene_id="room")
    pipeline.scripts = {"project": Script(id="project", title="Test", original_text="", created_at=0, updated_at=0, frames=[frame])}
    pipeline._save_data = Mock()
    pipeline.update_frame("project", "frame", action_description="Visible edit", workbench_prompt_is_optimized=True, lighting_override="New")
    assert frame.action_description == "Visible edit"
    assert frame.visual_description == "Visible edit"
    assert frame.workbench_prompt_is_optimized


def test_polish_projection_uses_unsaved_overrides_and_replaces_plan_lighting(monkeypatch):
    import json
    from src.apps.comic_gen import api
    frame = StoryboardFrame(id="frame", scene_id="room", lighting_override="stored light",
        director_shot_context={"shot": {"lighting": "plan light", "visual_intent": "action"}})
    monkeypatch.setattr(api.pipeline, "get_script", lambda _: Mock(frames=[frame]))
    result = json.loads(api._get_director_prompt_context("project", "frame", {"style": "current style", "lighting": "unsaved light"}))
    assert result["shot_overrides"] == {"style": "current style", "lighting": "unsaved light"}
    assert "lighting" not in result["shot"]


def test_polish_overrides_exist_without_plan_context(monkeypatch):
    import json
    from src.apps.comic_gen import api
    frame = StoryboardFrame(id="frame", scene_id="room", lighting_override="current light")
    monkeypatch.setattr(api.pipeline, "get_script", lambda _: Mock(frames=[frame]))
    assert json.loads(api._get_director_prompt_context("project", "frame"))["shot_overrides"]["lighting"] == "current light"


def test_polish_context_carries_confirmed_screen_geography_without_director_plan(monkeypatch):
    import json
    from src.apps.comic_gen import api
    frame = StoryboardFrame(id="frame", scene_id="shop", blocking=Blocking(
        description="掌柜始终在店内柜台后；匪寇在街侧柜台前，柜台遮住掌柜下半身",
        camera_relation="街道平视，单镜头不进入店内",
        stage=[StageSubject(ref="掌柜", zone="left", depth="back", posture="standing")],
    ))
    monkeypatch.setattr(api.pipeline, "get_script", lambda _: Mock(frames=[frame]))
    context = json.loads(api._get_director_prompt_context("project", "frame"))
    assert "柜台遮住掌柜下半身" in context["blocking"]["description"]
    assert context["blocking"]["camera_relation"] == "街道平视，单镜头不进入店内"
    assert context["blocking"]["stage"][0]["depth"] == "back"


def test_settings_sync_preserves_structured_audio_and_later_edits():
    from src.apps.comic_gen.shot_prompt_settings import sync_prompt_settings
    body = 'subject_definitions: Qin; detailed_description: old light; my action; <d>old light</d>; "old light"; overall_soundscape: old light is spoken; non_diegetic_music: N/A'
    changed = sync_prompt_settings(body, "", "old light", "", "new light")
    assert "new light" in changed.split("overall_soundscape:")[0]
    assert "old light; my action" not in changed
    assert '<d>old light</d>; "old light"' in changed
    assert "overall_soundscape: old light is spoken; non_diegetic_music: N/A" in changed
    edited = changed + "\nmanual edit"
    again = sync_prompt_settings(edited, "", "new light", "film grain", "latest light")
    assert "manual edit" in again
    assert again.count("【当前镜头设定】") == 1
    assert "new light" not in again
    assert sync_prompt_settings(again, "film grain", "latest light", "film grain", "latest light") == again


def test_update_request_carries_adopted_text_and_flag_together(monkeypatch):
    from src.apps.comic_gen import api
    pipeline = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    api.update_frame("project", api.UpdateFrameRequest(frame_id="frame", action_description="visible text",
        workbench_prompt_is_optimized=True, lighting_override="new light"))
    supplied = pipeline.update_frame.call_args.kwargs
    assert supplied["action_description"] == "visible text"
    assert supplied["workbench_prompt_is_optimized"] is True
    assert supplied["lighting_override"] == "new light"


@pytest.mark.parametrize("reference_mode", [False, True])
def test_polish_model_receives_current_fields_before_generation(monkeypatch, reference_mode):
    from src.apps.comic_gen import api
    processor = Mock()
    processor.polish_video_prompt.return_value = processor.polish_r2v_prompt.return_value = {"prompt_cn": "结果", "prompt_en": "result"}
    frame = StoryboardFrame(id="frame", scene_id="room", director_shot_context={"shot": {"lighting": "old plan light"}})
    monkeypatch.setattr(api.pipeline, "get_script", lambda _: Mock(frames=[frame]))
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_polish_model_for_project", lambda *args: "")
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    values = dict(draft_prompt="visible draft", script_id="project", frame_id="frame", shot_overrides={"style": "current style", "lighting": "current light"})
    if reference_mode:
        request = api.PolishR2VPromptRequest(**values, slots=[])
        preview = api.preview_r2v_polish_prompt(request)
        api.polish_r2v_prompt(request.model_copy(update={"review_token": preview["review_token"], "reviewed_messages": preview["messages"]}))
        call = processor.polish_r2v_prompt.call_args
        instructions = call.args[3]
    else:
        request = api.PolishVideoPromptRequest(**values)
        preview = api.preview_video_polish_prompt(request)
        api.polish_video_prompt(request.model_copy(update={"review_token": preview["review_token"], "reviewed_messages": preview["messages"]}))
        call = processor.polish_video_prompt.call_args
        instructions = call.args[2]
    assert call.args[0] == "visible draft"
    assert "current light" in instructions
    assert "current style" in instructions
    assert "old plan light" not in instructions
