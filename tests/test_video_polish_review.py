"""Video polish must send only the reviewed creative text and selected images."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api
from src.apps.comic_gen.llm import ScriptProcessor


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
    monkeypatch.setattr(api, "_get_custom_prompt", lambda *args: "")
    monkeypatch.setattr(api, "_get_director_prompt_context", lambda *args: "")
    request = api.PolishVideoPromptRequest(script_id="project", frame_id="shot", draft_prompt="长街",
                                          shot_overrides={"style": "", "lighting": "current"})
    confirmed, _ = _confirmed(request)
    frame.lighting_override = "changed by another editor"
    with pytest.raises(HTTPException) as rejected:
        api._require_video_polish_review(confirmed, False)
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
