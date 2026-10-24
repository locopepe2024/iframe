"""Video polish must send only the reviewed creative text and selected images."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api
from src.apps.comic_gen.llm import ScriptProcessor
from src.apps.comic_gen.models import Blocking, StoryboardFrame


def _confirmed(request, reference_mode=False):
    preview = api._compile_video_polish_review(request, reference_mode)
    return request.model_copy(update={
        "review_token": preview["review_token"],
        "reviewed_messages": preview["messages"],
    }), preview


def test_unreviewed_video_polish_never_calls_model(monkeypatch):
    processor = Mock()
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    with pytest.raises(HTTPException) as rejected:
        api.polish_video_prompt(api.PolishVideoPromptRequest(draft_prompt="街道人流"))
    assert rejected.value.status_code == 409
    processor.polish_video_prompt.assert_not_called()


def test_preview_rejects_project_owned_by_another_profile(monkeypatch):
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(owner_profile_id="other"))
    get_script = Mock(return_value=None)
    monkeypatch.setattr(api.pipeline, "get_script", get_script)
    custom = Mock(return_value="private director context")
    monkeypatch.setattr(api, "_get_custom_prompt", custom)
    with pytest.raises(HTTPException) as rejected:
        api.preview_video_polish_prompt(api.PolishVideoPromptRequest(script_id="private", draft_prompt="shot"))
    assert rejected.value.status_code == 404
    get_script.assert_called_once_with("private", "other")
    custom.assert_not_called()


def test_reviewed_edit_removes_director_constraint_from_actual_model_message(monkeypatch):
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "残阳染红整个街面")
    request = api.PolishVideoPromptRequest(draft_prompt="长街人来人往", generation_mode="t2v")
    confirmed, preview = _confirmed(request)
    assert "残阳染红整个街面" in preview["messages"]["system"]
    confirmed.reviewed_messages = {"system": "只保留用户指定的冷灰蓝光影。", "user": "长街人来人往"}
    processor = ScriptProcessor.__new__(ScriptProcessor)
    chat = Mock(return_value='{"prompt_cn":"中文镜头","prompt_en":"English shot"}')
    processor.llm = SimpleNamespace(is_configured=True, chat=chat)
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    api.polish_video_prompt(confirmed)
    messages = chat.call_args.kwargs["messages"]
    assert messages == [
        {"role": "system", "content": "只保留用户指定的冷灰蓝光影。"},
        {"role": "user", "content": "长街人来人往"},
    ]
    assert "残阳染红整个街面" not in str(messages)


def test_changed_source_rejects_old_token(monkeypatch):
    state = {"director": "冷灰蓝"}
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: state["director"])
    confirmed, _ = _confirmed(api.PolishVideoPromptRequest(draft_prompt="长街"))
    state["director"] = "暖红"
    processor = Mock()
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    with pytest.raises(HTTPException) as rejected:
        api.polish_video_prompt(confirmed)
    assert rejected.value.status_code == 409
    processor.polish_video_prompt.assert_not_called()


def test_saved_shot_edit_invalidates_review_even_with_same_submitted_overrides(monkeypatch):
    frame = SimpleNamespace(id="shot", lighting_override="old")
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(owner_profile_id="owner"))
    monkeypatch.setattr(api.pipeline, "get_script", lambda script_id, owner: SimpleNamespace(frames=[frame]))
    monkeypatch.setattr(api.pipeline, "storyboard_continuity_sheet", lambda script_id: {
        "rows": [{"frame_id": "shot", "fields": {}}],
    })
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "")
    request = api.PolishVideoPromptRequest(script_id="project", frame_id="shot", draft_prompt="长街",
                                          shot_overrides={"style": "", "lighting": "current"})
    confirmed, _ = _confirmed(request)
    frame.lighting_override = "changed by another editor"
    with pytest.raises(HTTPException) as rejected:
        api._require_video_polish_review(confirmed, False)
    assert rejected.value.status_code == 409


def test_blocking_change_invalidates_reviewed_r2v_input(monkeypatch):
    frame = StoryboardFrame(id="shot", scene_id="shop", blocking=Blocking(
        description="掌柜在店内柜台后，匪寇在街上柜台前，柜台挡住掌柜双脚",
        camera_relation="街道平视的连续单镜头",
    ))
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(owner_profile_id="owner"))
    monkeypatch.setattr(api.pipeline, "get_script", lambda *_args: SimpleNamespace(frames=[frame]))
    monkeypatch.setattr(api.pipeline, "storyboard_continuity_sheet", lambda _script_id: {
        "rows": [{"frame_id": "shot", "fields": {}}],
    })
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *_args: "")
    request = api.PolishR2VPromptRequest(script_id="project", frame_id="shot", draft_prompt="匪寇抢粮", slots=[])
    reviewed, preview = _confirmed(request, True)
    assert "柜台挡住掌柜双脚" in preview["messages"]["system"]
    frame.blocking.description = "掌柜走到街上"
    with pytest.raises(HTTPException) as rejected:
        api._require_video_polish_review(reviewed, True)
    assert rejected.value.status_code == 409


def test_h3_format_conflict_is_rejected_before_model_call(monkeypatch):
    request = api.PolishVideoPromptRequest(draft_prompt="长街", target_video_model="uniart/minimax-h3-vip")
    confirmed, _ = _confirmed(request)
    confirmed.reviewed_messages = {"system": "只写散文", "user": "长街"}
    processor = Mock()
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    with pytest.raises(HTTPException) as rejected:
        api.polish_video_prompt(confirmed)
    assert rejected.value.status_code == 422
    processor.polish_video_prompt.assert_not_called()


def test_first_last_review_preserves_image_order_and_text(monkeypatch):
    request = api.PolishVideoPromptRequest(
        draft_prompt="街道", generation_mode="first_last_frame",
        image_urls=["first.png", "last.png"],
    )
    confirmed, preview = _confirmed(request)
    assert [item["label"] for item in preview["media"]] == ["首帧 0.00 秒", "尾帧 结束时"]
    processor = ScriptProcessor.__new__(ScriptProcessor)
    chat = Mock(return_value='{"prompt_cn":"首帧到尾帧","prompt_en":"first frame to last frame"}')
    processor.llm = SimpleNamespace(is_configured=True, chat=chat)
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    monkeypatch.setattr("src.apps.comic_gen.llm._resolve_image_for_vision", lambda url: url)
    api.polish_video_prompt(confirmed)
    sent = chat.call_args.kwargs["messages"]
    assert sent[0]["content"] == preview["messages"]["system"]
    parts = sent[1]["content"]
    assert [part["image_url"]["url"] for part in parts if part["type"] == "image_url"] == ["first.png", "last.png"]
    assert parts[-1] == {"type": "text", "text": preview["messages"]["user"]}


def test_r2v_reviewed_text_reaches_model_without_hidden_append(monkeypatch):
    request = api.PolishR2VPromptRequest(draft_prompt="角色入场", slots=[api.RefSlot(description="主角")])
    confirmed, preview = _confirmed(request, True)
    confirmed.reviewed_messages = {"system": "仅保留角色外观。", "user": "角色入场"}
    processor = ScriptProcessor.__new__(ScriptProcessor)
    chat = Mock(return_value='{"prompt_cn":"中文镜头","prompt_en":"English shot"}')
    processor.llm = SimpleNamespace(is_configured=True, chat=chat)
    monkeypatch.setattr(api, "ScriptProcessor", lambda: processor)
    api.polish_r2v_prompt(confirmed)
    assert chat.call_args.kwargs["messages"] == [
        {"role": "system", "content": "仅保留角色外观。"},
        {"role": "user", "content": "角色入场"},
    ]
    assert "character1" in preview["messages"]["system"]


def test_minimax_ir_uses_reviewed_text(monkeypatch):
    from src.models import uniart
    request = api.PolishVideoPromptRequest(
        draft_prompt="街道", optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip",
    )
    confirmed, preview = _confirmed(request)
    assert "H3 constraint" in preview["messages"]["user"]
    confirmed.reviewed_messages = {"system": "", "user": "冷灰蓝长街。"}
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(user_id="u", owner_profile_id="o"))
    monkeypatch.setattr("src.apps.studio_access.runtime_uniart_for_owner", lambda *args: object())
    complete = Mock(return_value="镜头")
    monkeypatch.setattr(uniart, "complete_context_ir", complete)
    api._complete_minimax_ir_polish(confirmed, "unused", confirmed.reviewed_messages["user"])
    assert complete.call_args.args[1][0]["text"] == "冷灰蓝长街。"


def test_minimax_ir_accepts_native_prompt_without_local_h3_headings(monkeypatch):
    from src.models import uniart
    native_prompt = "镜头连续推进。0.00-0.40s 匪首踢中掌柜；掌柜撞到木桌，桌面物品滑落，随后倒地。"
    request = api.PolishVideoPromptRequest(
        draft_prompt="匪首踢中掌柜，掌柜撞桌倒地", optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip", target_duration=4,
    )
    confirmed, _ = _confirmed(request)
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(user_id="u", owner_profile_id="o"))
    monkeypatch.setattr("src.apps.studio_access.runtime_uniart_for_owner", lambda *args: object())
    monkeypatch.setattr(uniart, "complete_context_ir", Mock(return_value=native_prompt))

    assert api.polish_video_prompt(confirmed) == {"prompt_cn": native_prompt, "prompt_en": native_prompt}


def test_minimax_ir_native_prompt_keeps_mode_and_dialogue_checks():
    from src.apps.comic_gen.llm import PolishError

    with pytest.raises(PolishError, match="first or last frame"):
        api._validate_context_ir_polish_result(
            {"prompt_en": "首帧开始，人物走出门口。"}, generation_mode="first_last_frame",
        )
    with pytest.raises(PolishError, match="mislabeled as T2VA"):
        api._validate_context_ir_polish_result(
            {"prompt_en": "[T2VA] 人物走出门口。"}, reference_mode=True,
        )
    with pytest.raises(PolishError, match="omitted the shot dialogue"):
        api._validate_context_ir_polish_result(
            {"prompt_en": "人物走出门口。"}, generate_audio=True, dialogue_line="让开！",
        )


def test_minimax_ir_preview_keeps_long_draft_under_provider_limit():
    draft = "0.00-0.50s: 匪首踢击；0.50-1.00s: 掌柜撞桌。" + "保持首帧人物和光影。" * 330
    request = api.PolishVideoPromptRequest(
        draft_prompt=draft, optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip", target_duration=4,
    )
    preview = api.preview_video_polish_prompt(request)
    text = preview["messages"]["user"]
    assert draft in text
    assert "Preserve explicit visual timings" in text
    assert len(text) < api._MINIMAX_IR_TEXT_LIMIT


def test_minimax_ir_rejects_oversized_review_before_provider_call(monkeypatch):
    from src.models import uniart
    from src.apps.comic_gen.llm import PolishError
    request = api.PolishVideoPromptRequest(
        draft_prompt="动作", optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip",
    )
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(user_id="u", owner_profile_id="o"))
    monkeypatch.setattr("src.apps.studio_access.runtime_uniart_for_owner", lambda *args: object())
    complete = Mock()
    monkeypatch.setattr(uniart, "complete_context_ir", complete)

    with pytest.raises(PolishError, match="7000-character limit"):
        api._complete_minimax_ir_polish(request, "rules", "x" * 7001)
    complete.assert_not_called()


def test_minimax_ir_resolves_studio_media_before_provider_submission(monkeypatch):
    from src.models import uniart
    request = api.PolishVideoPromptRequest(
        draft_prompt="踢击", optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip", image_urls=["/studio/media/owned/first.png"],
    )
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(user_id="u", owner_profile_id="o"))
    monkeypatch.setattr("src.apps.studio_access.runtime_uniart_for_owner", lambda *args: object())
    resolved = Mock(return_value=["/app/output/users/owned/studio/first.png"])
    signed = Mock(return_value="https://media.example/first.png")
    complete = Mock(return_value="optimized prompt")
    monkeypatch.setattr(api, "_polish_image_urls", resolved)
    monkeypatch.setattr(uniart, "_image_reference_url", signed)
    monkeypatch.setattr(uniart, "complete_context_ir", complete)

    result = api._complete_minimax_ir_polish(request, "rules", "reviewed input")

    resolved.assert_called_once_with(request.image_urls)
    signed.assert_called_once_with("/app/output/users/owned/studio/first.png")
    assert complete.call_args.args[1][-1]["image_url"]["url"] == "https://media.example/first.png"
    assert result["prompt_en"] == "optimized prompt"


def test_minimax_ir_reports_invalid_studio_media_without_provider_call(monkeypatch):
    from src.models import uniart
    from src.apps.comic_gen.llm import PolishError
    request = api.PolishVideoPromptRequest(
        draft_prompt="踢击", optimizer_provider="minimax_context_ir",
        target_video_model="uniart/minimax-h3-vip", image_urls=["/studio/media/invalid/first.png"],
    )
    monkeypatch.setattr(api, "current_studio_user", lambda: SimpleNamespace(user_id="u", owner_profile_id="o"))
    monkeypatch.setattr("src.apps.studio_access.runtime_uniart_for_owner", lambda *args: object())
    monkeypatch.setattr(api, "resolve_studio_reference", Mock(side_effect=ValueError("invalid reference")))
    complete = Mock()
    monkeypatch.setattr(uniart, "complete_context_ir", complete)

    with pytest.raises(PolishError, match="Reference image could not be read"):
        api._complete_minimax_ir_polish(request, "rules", "reviewed input")
    complete.assert_not_called()
