import copy
import json
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.llm import ScriptProcessor, DirectorShootingChunkError
from tests.test_director_shooting_plan import raw_shot, raw_scene, valid_chunk, story_map


def run(responses, **kwargs):
    p = ScriptProcessor.__new__(ScriptProcessor)
    p.llm = Mock(is_configured=True)
    p.llm.chat.side_effect = [json.dumps(v) for v in responses]
    plan = raw_scene()
    plan['beats'][0].pop('shots')
    return p, lambda: p._plan_director_shooting_beat(
        'SOURCE_ONLY_ONCE', {}, {'story_map': story_map().model_dump()}, {},
        beat_plan=plan, model='greena/llm-nf-all', **kwargs)


def test_actual_beat_prompt_has_one_complete_schema_without_full_scene_instructions():
    p, call = run([{'shots': [raw_shot()]}])
    call()
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    schema = json.loads(prompt.split('<shot_output_contract>')[1].split('</shot_output_contract>')[0])
    assert schema['properties']['shots']['maxItems'] == 3
    shot = schema['$defs']['GeneratedShootingShot']
    assert shot['additionalProperties'] is False
    assert 'visual_intensity' not in shot['properties']
    assert 'shot_id' not in shot['properties']
    assert 'lighting_override_selected' not in shot['properties']
    assert schema['$defs']['DirectorPlanLighting']['additionalProperties'] is False
    assert schema['$defs']['DirectorInformationDesign']['properties']['source_event_ids']['items']['enum'] == ['event-cinema']
    assert '每场 scene 填' not in prompt and '每个 beat 填' not in prompt
    assert prompt.count('SOURCE_ONLY_ONCE') == 1


def test_repair_receives_previous_json_and_all_independent_issues_without_exposing_values(caplog):
    bad = {'shots': [raw_shot(visual_intensity='PRIVATE_BAD_VALUE',
                             duration_seconds=True, information_design={'source_event_ids': ['PRIVATE_EVENT']})]}
    p, call = run([bad, {'shots': [raw_shot()]}])
    result = call()
    assert len(result['scenes'][0]['beats'][0]['shots']) == 1
    messages = p.llm.chat.call_args.kwargs['messages']
    assert json.loads(messages[1]['content']) == bad
    prompt = messages[0]['content']
    assert 'visual_intensity' in prompt and 'duration_seconds' in prompt and 'source_event_ids' in prompt
    assert 'PRIVATE_EVENT' not in prompt and 'PRIVATE_BAD_VALUE' not in caplog.text
    assert all(c.kwargs['stream'] and c.kwargs['timeout_seconds'] == 1800 for c in p.llm.chat.call_args_list)
    assert all(c.kwargs['model'] == 'greena/llm-nf-all' for c in p.llm.chat.call_args_list)


@pytest.mark.parametrize('overrides', [
    {'dialogue': [{'speaker': '', 'line': 'Do not delete this line'}]},
    {'lighting': {'key_source': 'x' * 241}},
    {'character_ids': ['same', 'same']},
    {'visual_intensity': 'invented'},
])
def test_invalid_shot_is_rejected_before_admission_without_silent_cleanup(overrides):
    bad = {'shots': [raw_shot(**overrides)]}
    before = copy.deepcopy(bad)
    p, call = run([bad, bad])
    with pytest.raises(DirectorShootingChunkError):
        call()
    assert p.llm.chat.call_count == 2 and bad == before


def test_all_schema_errors_are_also_rejected_by_chunk_admission():
    invalid = valid_chunk()
    invalid['scenes'][0]['beats'][0]['shots'][0]['lighting']['key_source'] = 'x' * 241
    assert ScriptProcessor._validate_director_shooting_chunk(invalid)


def test_persistent_failure_keeps_safe_combined_diagnostics():
    bad = {'shots': [raw_shot(visual_intensity='PRIVATE_VALUE', duration_seconds=True)]}
    p, call = run([bad, bad])
    with pytest.raises(DirectorShootingChunkError) as error:
        call()
    diagnostic = error.value.shooting_contract_diagnostic
    assert diagnostic['attempts'] == 2 and diagnostic['scope'] == 'shots'
    assert any('visual_intensity' in e for e in diagnostic['issues'])
    assert any('duration_seconds' in e for e in diagnostic['issues'])
    assert 'PRIVATE_VALUE' not in json.dumps(diagnostic)


def test_large_rejected_json_never_expands_repair_context():
    bad = {'shots': [raw_shot(visual_intent='x' * 9000)]}
    p, call = run([bad, {'shots': [raw_shot()]}])
    call()
    messages = p.llm.chat.call_args.kwargs['messages']
    assert len(messages) == 2
    assert 'x' * 9000 not in json.dumps(messages)


def test_cached_schema_invalid_detail_regenerates_only_its_beat():
    from tests.test_shooting_plan_stages import processor, generate
    p = processor()
    snapshots = []
    generate(p, save_checkpoint=lambda s: snapshots.append(copy.deepcopy(s)) or True)
    state = snapshots[-1]
    state['details']['0:1'] = copy.deepcopy(state['details']['0:1'])
    state['details']['0:1']['shots'][0]['visual_intensity'] = 'invalid'
    first = copy.deepcopy(state['details']['0:0'])
    p._plan_director_shooting_beat.reset_mock()
    generate(p, checkpoint=state, save_checkpoint=lambda s: snapshots.append(copy.deepcopy(s)) or True)
    assert p._plan_director_shooting_beat.call_count == 1
    assert snapshots[-1]['details']['0:0'] == first
    assert 'visual_intensity' not in json.dumps(snapshots[-1])


def test_pipeline_keeps_real_beat_location_and_safe_contract_diagnostics():
    from tests.test_director_shooting_plan import make_pipeline
    pipeline, script = make_pipeline()
    error = DirectorShootingChunkError('contract_violation', 'shots.2.visual_intensity: 存在未知字段')
    error.shooting_plan_failure = {'stage': 'shots', 'scene': 3, 'beat': 1}
    error.shooting_contract_diagnostic = {'scope': 'shots', 'issues': ['shots.2.visual_intensity: extra_forbidden']}
    pipeline.script_processor.plan_director_shooting_chunk.side_effect = error
    with pytest.raises(DirectorShootingChunkError) as failure:
        pipeline.preview_director_shooting_plan(script.id)
    assert '场景 3 节拍 1' in failure.value.public_reason
    assert failure.value.shooting_contract_diagnostic == error.shooting_contract_diagnostic
