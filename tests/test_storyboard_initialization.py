import json
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.models import Scene, Script, StoryboardFrame
from src.apps.comic_gen.pipeline import ComicGenPipeline


def setup_pipeline():
    scene = Scene(id="scene", name="长街", description="青石路面")
    previous = StoryboardFrame(id="previous", scene_id="scene", action_description="前镜拔刀", dialogue="前镜对白")
    current = StoryboardFrame(id="current", scene_id="scene", action_description="乙抬眼", dialogue="别动",
                              shot_size="中景", camera_angle="平视", composition="主体偏左", duration=6)
    script = Script(id="project", title="Story", original_text="source", created_at=1, updated_at=1,
                    scenes=[scene], frames=[previous, current])
    pipeline = ComicGenPipeline.__new__(ComicGenPipeline)
    pipeline.scripts = {script.id: script}
    pipeline.series_store = {}
    pipeline.resolve_project_assets = Mock(return_value={"characters": [], "scenes": [scene], "props": []})
    pipeline.script_processor = Mock()
    pipeline._save_data = Mock()
    return pipeline, script, previous, current


def test_initialization_proposes_only_missing_fields_without_neighbor_input():
    pipeline, script, previous, current = setup_pipeline()
    pipeline.script_processor.refine_frame_to_rich.return_value = {
        "visual_description": "乙站在长街抬眼", "blocking": {"description": "乙在画面左侧"},
        "shot_size": "特写", "duration": 9, "dialogue_structured": {"speaker": "乙", "line": "重写对白"},
    }
    before = pipeline._rich_refinement_source_hash(script, current, initialization=True)
    pipeline.refine_frame(script.id, current.id, initialization=True)
    candidate = current.rich_refinement_candidate
    assert set(candidate["fields"]) == {"visual_description", "blocking"}
    assert candidate["mode"] == "initialization"
    assert current.visual_description is None and current.blocking is None
    assert current.shot_size == "中景" and current.dialogue == "别动" and current.duration == 6
    args = pipeline.script_processor.refine_frame_to_rich.call_args
    assert args.args[3:5] == (None, None)
    assert args.kwargs["initialization"] is True
    assert "前镜拔刀" not in str(args)
    assert "前镜对白" not in str(args)
    previous.action_description = "前镜收刀"
    assert pipeline._rich_refinement_source_hash(script, current, initialization=True) == before
    pipeline.apply_rich_refinement_candidate(script.id, current.id, candidate["id"], ["blocking"])
    assert current.blocking.description == "乙在画面左侧"
    assert current.visual_description is None
    assert current.dialogue == "别动" and current.shot_size == "中景"


def test_initialization_does_not_propose_over_existing_values():
    pipeline, script, _, current = setup_pipeline()
    current.visual_description = "已确认首帧"
    current.blocking = {"description": "现有站位"}
    pipeline.refine_frame(script.id, current.id, initialization=True)
    pipeline.script_processor.refine_frame_to_rich.assert_not_called()
    assert current.rich_refinement_candidate is None
    pipeline._save_data.assert_not_called()


def test_initialization_only_proposes_remaining_missing_field_and_rejects_stale_apply():
    pipeline, script, _, current = setup_pipeline()
    current.visual_description = "已确认首帧"
    pipeline.script_processor.refine_frame_to_rich.return_value = {
        "visual_description": "模型重写首帧", "blocking": {"description": "乙在左侧"},
    }
    pipeline.refine_frame(script.id, current.id, initialization=True)
    candidate = current.rich_refinement_candidate
    assert set(candidate["fields"]) == {"blocking"}
    assert current.visual_description == "已确认首帧"
    current.action_description = "乙转身离开"
    with pytest.raises(ValueError, match="context changed"):
        pipeline.apply_rich_refinement_candidate(script.id, current.id, candidate["id"], ["blocking"])
    assert current.blocking is None


def test_initialization_batch_uses_missing_field_mode():
    pipeline, script, _, current = setup_pipeline()
    pipeline.script_processor.refine_frame_to_rich.return_value = {"visual_description": "乙抬眼"}
    events = list(pipeline.initialize_batch_generator(script.id))
    assert events[-1] == ("initialize_complete", {"total": 2, "success": 2, "failed": 0})
    assert current.rich_refinement_candidate["mode"] == "initialization"
    assert current.visual_description is None


@pytest.mark.parametrize("result", [None, {}, {"rationale": {"visual_description": "无依据"}}])
def test_initialization_batch_counts_missing_model_proposal_as_failure(result):
    pipeline, script, _, _ = setup_pipeline()
    pipeline.script_processor.refine_frame_to_rich.return_value = result
    events = list(pipeline.initialize_batch_generator(script.id))
    assert events[-1] == ("initialize_complete", {"total": 2, "success": 0, "failed": 2})
    assert [event for event, _ in events].count("frame_initialize_error") == 2
    assert all(frame.rich_refinement_candidate is None for frame in script.frames)


def test_initialization_llm_rejects_extra_fields():
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps({"visual_description": "乙抬眼", "dialogue": "前镜对白"})
    with pytest.raises(ValueError, match="invalid JSON fields"):
        processor.refine_frame_to_rich({"action_summary": "乙抬眼"}, [], [], initialization=True)
    prompt = processor.llm.chat.call_args.kwargs["messages"][0]["content"]
    assert "Previous Frame Context" not in prompt
    assert "Next Frame Context" not in prompt
