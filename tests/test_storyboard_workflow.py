from src.apps.comic_gen.models import DirectorPlanDialogueLine

import pytest

from tests.test_director_shooting_plan import make_pipeline, make_plan, SOURCE_TEXT
from src.apps.comic_gen.pipeline import StaleStoryboardDraftError
from src.apps.comic_gen.storyboard_workflow import materialize_plan, validate_plan_coverage
from src.apps import director_skills


def confirmed():
    pipeline, script = make_pipeline()
    plan = make_plan(pipeline)
    plan.scenes[0].scene_asset_id = 'cinema'
    plan.scenes[0].beats[0].shots[0].dialogue = [
        DirectorPlanDialogueLine(speaker='沈夏', line='走吧'), DirectorPlanDialogueLine(speaker='周涵', line='好')]
    pipeline.save_director_shooting_plan_draft('film', 1, 0, plan)
    pipeline.apply_director_shooting_plan('film', plan, 0, 1)
    return pipeline, script


def test_auto_materializes_confirmed_plan_without_llm_and_applies_context():
    pipeline, script = confirmed()
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT)
    assert lineage.storyboard_mode == 'plan'
    draft = pipeline.preview_storyboard_analysis('film', SOURCE_TEXT, expected_lineage=lineage)
    pipeline.script_processor.analyze_to_storyboard.assert_not_called()
    assert [item['shot_id'] for item in draft] == ['shot-entry']
    assert draft[0]['dialogue'] == '沈夏：走吧\n周涵：好'
    result = pipeline.analyze_text_to_frames('film', SOURCE_TEXT, draft, lineage)
    frame = result.frames[0]
    assert frame.shot_id == 'shot-entry'
    assert frame.scene_id == 'cinema'
    assert len(frame.director_shot_context['shot']['dialogue']) == 2
    assert frame.generation_lineage.shooting_plan_revision == 1
    assert frame.character_acting == draft[0]['character_acting']


@pytest.mark.parametrize('ids', [['a'], ['a', 'x'], ['b', 'a'], ['a', 'b', 'a'], [None, 'b']])
def test_coverage_rejects_loss_unknown_and_reordering(ids):
    with pytest.raises(ValueError):
        validate_plan_coverage([{'shot_id': 'a'}, {'shot_id': 'b'}], [{'shot_id': key} for key in ids])


def test_coverage_allows_contiguous_splitting():
    validate_plan_coverage([{'shot_id': 'a'}, {'shot_id': 'b'}],
                           [{'shot_id': key} for key in ['a', 'a', 'b']])


def test_materialize_plan_carries_structured_crowd_instances():
    context = {
        'scenes': [{'scene_id': 'street', 'scene_ref': '粮铺'}],
        'shots': [{
            'shot_id': 'shot-1', 'scene_id': 'street', 'character_ids': [], 'prop_ids': [],
            'crowd_instances': [{
                'template_id': 'townspeople', 'layer': 'mid',
                'region': '粮铺两侧', 'motion': '近景避让，中景观察，远景通行',
            }],
        }],
    }
    result = materialize_plan(context, {'characters': [], 'props': []})
    assert result[0]['crowd_instances'][0]['template_id'] == 'townspeople'
    assert result[0]['crowd_instances'][0]['layer'] == 'mid'


def test_apply_missing_shot_leaves_saved_frames_unchanged():
    pipeline, script = confirmed()
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT)
    old_frames = list(script.frames)
    with pytest.raises(ValueError):
        pipeline.analyze_text_to_frames('film', SOURCE_TEXT, [{'action_summary': 'wrong'}], lineage)
    assert script.frames == old_frames


def test_plan_revision_change_rejects_draft():
    pipeline, script = confirmed()
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT)
    script.director_shooting_plan_revisions[-1].revision += 1
    with pytest.raises(StaleStoryboardDraftError, match='shooting_plan_revision'):
        pipeline.validate_storyboard_lineage('film', SOURCE_TEXT, lineage)


def test_plan_requires_full_source_and_no_skills():
    pipeline, _ = confirmed()
    with pytest.raises(ValueError, match='完整'):
        pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT[:5], 'plan')
    with pytest.raises(ValueError, match='Skills'):
        pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT, 'plan', director_skills.catalog('storyboard'))


def test_script_skill_snapshot_reaches_generation_and_refinement():
    pipeline, script = make_pipeline()
    selected = director_skills.catalog('storyboard')[:1]
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT, 'script', selected)
    pipeline.script_processor.analyze_to_storyboard.return_value = [{'action_summary': 'walk'}]
    pipeline.preview_storyboard_analysis('film', SOURCE_TEXT, expected_lineage=lineage, skill_snapshot=selected)
    assert pipeline.script_processor.analyze_to_storyboard.call_args.args[1]['selected_creative_methods'] == selected
    pipeline.script_processor.refine_storyboard_analysis.return_value = [{'action_summary': 'walk'}]
    pipeline.refine_storyboard_analysis('film', SOURCE_TEXT, [{'action_summary': 'walk'}], ['adjust'], lineage)
    assert pipeline.script_processor.refine_storyboard_analysis.call_args.args[1]['selected_creative_methods'] == selected
    assert lineage.creative_skill_run[0]['label'] == selected[0]['label']


def test_split_duration_is_preserved_on_apply_and_invalid_sum_rejected():
    pipeline, script = confirmed()
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT)
    draft = pipeline.preview_storyboard_analysis('film', SOURCE_TEXT, expected_lineage=lineage)
    split = [{**draft[0], 'duration': 2, 'dialogue': '沈夏：走吧'},
             {**draft[0], 'duration': 2, 'dialogue': '周涵：好'}]
    result = pipeline.analyze_text_to_frames('film', SOURCE_TEXT, split, lineage)
    assert [frame.duration for frame in result.frames] == [2, 2]
    assert [frame.dialogue for frame in result.frames] == ['沈夏：走吧', '周涵：好']
    with pytest.raises(ValueError, match='时长'):
        pipeline.analyze_text_to_frames('film', SOURCE_TEXT, [split[0]], lineage)


def test_selected_method_is_in_actual_model_prompt():
    import json
    from src.apps.comic_gen.llm import ScriptProcessor
    from unittest.mock import Mock
    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = json.dumps({'frames': [{'action_summary': 'walk', 'scene_ref_name': 'street', 'visual_atmosphere': 'calm', 'character_acting': 'walking', 'key_action_physics': 'steps', 'lighting': {'direction': 'front'}}]})
    selected = director_skills.catalog('storyboard')[:1]
    entities = {'characters': [], 'scenes': [], 'props': [], 'selected_creative_methods': selected}
    processor.analyze_to_storyboard('source', entities)
    messages = processor.llm.chat.call_args.kwargs["messages"]
    prompt = str(messages)
    assert selected[0]['instructions'] in prompt
    assert '<performer_tier_skill>' in prompt
    assert '跨镜出现的固定群演沿用同一 ID' in prompt
    assert '[storyboard-suspense ' in prompt
    assert '[storyboard-action ' not in prompt


def test_script_workflow_does_not_depend_on_stale_plan_or_story_map():
    pipeline, script = confirmed()
    script.art_direction.director_profile.story_map.source_revision = 99
    lineage = pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT, 'script')
    assert lineage.shooting_plan_revision is None
    pipeline.script_processor.analyze_to_storyboard.return_value = [{'action_summary': 'walk'}]
    draft = pipeline.preview_storyboard_analysis('film', SOURCE_TEXT, expected_lineage=lineage)
    assert 'episode_visual_context' not in pipeline.script_processor.analyze_to_storyboard.call_args.args[1]
    pipeline.script_processor.refine_storyboard_analysis.return_value = draft
    pipeline.refine_storyboard_analysis('film', SOURCE_TEXT, draft, ['refine'], lineage)
    assert 'episode_visual_context' not in pipeline.script_processor.refine_storyboard_analysis.call_args.args[1]
    result = pipeline.analyze_text_to_frames('film', SOURCE_TEXT, draft, lineage)
    assert result.frames[0].shot_id is None
    with pytest.raises(ValueError, match='story map is stale'):
        pipeline.storyboard_workflow_lineage('film', SOURCE_TEXT, 'plan')
