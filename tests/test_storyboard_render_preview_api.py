from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api


def test_storyboard_polish_requires_reviewed_model_input(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace()
    monkeypatch.setattr(api, "pipeline", pipeline)
    request = api.RefinePromptRequest(frame_id="frame", raw_prompt="草稿")
    with pytest.raises(HTTPException) as error:
        api.refine_storyboard_prompt("episode", request, SimpleNamespace(owner_profile_id="owner"))
    assert error.value.status_code == 422
    pipeline.refine_frame_prompt.assert_not_called()


def test_preview_returns_confirmed_scene_design_source_separately_from_prompt(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace()
    pipeline.storyboard_render_context_token.return_value = "current"
    pipeline.preview_storyboard_render_prompt.return_value = "场景视觉基线：冷灰蓝环境光"
    pipeline.storyboard_render_preview_token.return_value = "reviewed"
    pipeline.storyboard_render_scene_design_source.return_value = "关联场景设计：长街 r2"
    pipeline.storyboard_render_omitted_plan_lighting.return_value = "残阳如血覆盖整条街"
    pipeline.storyboard_image_polish_review.return_value = "场景设计已变化；请核对润色正文后再生成。"
    monkeypatch.setattr(api, "pipeline", pipeline)

    result = api.preview_render_frame(
        "episode", api.RenderFramePreviewRequest(frame_id="shot", prompt="草稿"),
        SimpleNamespace(owner_profile_id="owner"),
    )

    assert result == {
        "prompt": "场景视觉基线：冷灰蓝环境光",
        "context_token": "reviewed",
        "source_label": "关联场景设计：长街 r2",
        "omitted_plan_lighting": "残阳如血覆盖整条街",
        "polish_review": "场景设计已变化；请核对润色正文后再生成。",
    }


def test_candidate_preview_labels_do_not_expose_variant_ids(monkeypatch):
    pipeline = Mock()
    frame = SimpleNamespace(id="shot", character_ids=["character-id"], scene_id="scene-id")
    pipeline.get_script.return_value = SimpleNamespace(
        frames=[frame], series_id=None,
        model_settings=SimpleNamespace(i2i_model="test-model", storyboard_aspect_ratio="16:9"),
    )
    pipeline.series_store = {}
    pipeline.resolve_project_assets.return_value = {
        "characters": [SimpleNamespace(id="character-id", name="阿青")],
        "scenes": [SimpleNamespace(id="scene-id", name="长街")],
    }
    pipeline.resolve_storyboard_asset_selection.return_value = {"assets": [
        {"asset_type": "character", "asset_id": "character-id", "variant_id": "private-character-uuid"},
        {"asset_type": "scene", "asset_id": "scene-id", "variant_id": "private-scene-uuid"},
    ]}
    pipeline.preview_storyboard_candidate_prompt.return_value = "已预览提示词"
    pipeline.storyboard_render_scene_design_source.return_value = "关联场景设计：长街 r2"
    pipeline.storyboard_image_polish_review.return_value = "场景设计已变化；请核对润色正文后再生成。"
    monkeypatch.setattr(api, "pipeline", pipeline)

    result = api.preview_frame_candidate(
        "episode", api.RenderFramePreviewRequest(frame_id="shot", prompt="草稿"),
        SimpleNamespace(owner_profile_id="owner"),
    )

    assert result["reference_asset_labels"] == ["阿青（已选参考图）", "长街（已选参考图）"]
    assert result["source_label"] == "关联场景设计：长街 r2"
    assert result["polish_review"].startswith("场景设计已变化")


def test_candidate_preview_rejects_shot_change_during_static_projection(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace(
        frames=[SimpleNamespace(id="shot")], series_id=None,
        model_settings=SimpleNamespace(i2i_model="test-model", storyboard_aspect_ratio="16:9"),
    )
    pipeline.storyboard_render_context_token.side_effect = ["before", "after"]
    pipeline.preview_storyboard_candidate_prompt.return_value = "首帧静态表情：玄宸：视线停住"
    monkeypatch.setattr(api, "pipeline", pipeline)

    with pytest.raises(HTTPException) as error:
        api.preview_frame_candidate(
            "episode", api.RenderFramePreviewRequest(frame_id="shot", prompt="草稿", slot="first"),
            SimpleNamespace(owner_profile_id="owner"),
        )
    assert error.value.status_code == 409
    pipeline.storyboard_candidate_preview_token.assert_not_called()


def test_preview_rejects_context_change_during_prompt_assembly(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace()
    pipeline.storyboard_render_context_token.side_effect = ["before", "after"]
    pipeline.preview_storyboard_render_prompt.return_value = "完整正文"
    monkeypatch.setattr(api, "pipeline", pipeline)

    with pytest.raises(HTTPException) as error:
        api.preview_render_frame(
            "episode", api.RenderFramePreviewRequest(frame_id="shot", prompt="草稿"),
            SimpleNamespace(owner_profile_id="owner"),
        )

    assert error.value.status_code == 409
    pipeline.storyboard_render_preview_token.assert_not_called()


def test_image_polish_apply_checks_owner_and_rejects_stale_candidate(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace()
    pipeline.apply_frame_image_polish_candidate.side_effect = ValueError("Shot or asset design changed")
    monkeypatch.setattr(api, "pipeline", pipeline)

    with pytest.raises(HTTPException) as error:
        api.apply_frame_image_polish(
            "episode", "shot", api.ApplyFrameImagePolishRequest(candidate_id="candidate"),
            SimpleNamespace(owner_profile_id="owner"),
        )
    assert error.value.status_code == 409
    pipeline.get_script.assert_called_once_with("episode", "owner")

    pipeline.get_script.return_value = None
    with pytest.raises(HTTPException) as error:
        api.apply_frame_image_polish(
            "episode", "shot", api.ApplyFrameImagePolishRequest(candidate_id="candidate"),
            SimpleNamespace(owner_profile_id="stranger"),
        )
    assert error.value.status_code == 404


def test_async_render_rejects_changed_preview_body_before_enqueuing(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace(frames=[SimpleNamespace(id="shot")])
    pipeline.storyboard_render_context_token.return_value = "context"
    pipeline.storyboard_render_preview_token.side_effect = lambda context, prompt, negative: f"{context}:{prompt}:{negative or ''}"
    jobs = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "extraction_jobs", jobs)

    request = api.RenderFrameJobRequest(
        frame_id="shot", prompt="改动后的正文", request_id="request-1",
        prompt_is_complete=True, context_token="context:预览正文:",
    )
    with pytest.raises(HTTPException) as error:
        api.start_render_frame_job("episode", request, SimpleNamespace(owner_profile_id="owner"))

    assert error.value.status_code == 409
    jobs.start.assert_not_called()


def test_async_render_rejects_changed_negative_prompt_before_enqueuing(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace(frames=[SimpleNamespace(id="shot")])
    pipeline.storyboard_render_context_token.return_value = "context"
    pipeline.storyboard_render_preview_token.side_effect = lambda context, prompt, negative: f"{context}:{prompt}:{negative or ''}"
    jobs = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "extraction_jobs", jobs)

    request = api.RenderFrameJobRequest(
        frame_id="shot", prompt="预览正文", negative_prompt="换过的负向词", request_id="request-1",
        prompt_is_complete=True, context_token="context:预览正文:原负向词",
    )
    with pytest.raises(HTTPException) as error:
        api.start_render_frame_job("episode", request, SimpleNamespace(owner_profile_id="owner"))

    assert error.value.status_code == 409
    jobs.start.assert_not_called()
