from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.apps.comic_gen import api


def test_preview_returns_confirmed_scene_design_source_separately_from_prompt(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace()
    pipeline.storyboard_render_context_token.return_value = "current"
    pipeline.preview_storyboard_render_prompt.return_value = "场景视觉基线：冷灰蓝环境光"
    pipeline.storyboard_render_preview_token.return_value = "reviewed"
    pipeline.storyboard_render_scene_design_source.return_value = "关联场景设计：长街 r2"
    pipeline.storyboard_render_omitted_plan_lighting.return_value = "残阳如血覆盖整条街"
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
    }


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


def test_async_render_rejects_changed_preview_body_before_enqueuing(monkeypatch):
    pipeline = Mock()
    pipeline.get_script.return_value = SimpleNamespace(frames=[SimpleNamespace(id="shot")])
    pipeline.storyboard_render_context_token.return_value = "context"
    pipeline.storyboard_render_preview_token.side_effect = lambda context, prompt: f"{context}:{prompt}"
    jobs = Mock()
    monkeypatch.setattr(api, "pipeline", pipeline)
    monkeypatch.setattr(api, "extraction_jobs", jobs)

    request = api.RenderFrameJobRequest(
        frame_id="shot", prompt="改动后的正文", request_id="request-1",
        prompt_is_complete=True, context_token="context:预览正文",
    )
    with pytest.raises(HTTPException) as error:
        api.start_render_frame_job("episode", request, SimpleNamespace(owner_profile_id="owner"))

    assert error.value.status_code == 409
    jobs.start.assert_not_called()
