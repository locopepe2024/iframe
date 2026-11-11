import copy
import json
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.llm import ScriptProcessor
from src.apps.comic_gen.shooting_plan_stages import split_shooting_source, normalize_structure_containers
from tests.test_director_shooting_plan import make_pipeline, raw_scene, valid_chunk


@pytest.mark.parametrize('text', [
    '场景一\r\n动作。\r\n\r\n“停！”\n\t对白\r结尾',
    ' \n\n' + '甲' * 600 + '\n \n乙',
    '一。二！三？四；五;六?七!最后一句',
    '',
])
def test_natural_source_units_reconstruct_exact_text_and_ranges(text):
    units = split_shooting_source(text)
    assert ''.join(unit['text'] for unit in units) == text
    assert all(0 < len(unit['text']) <= 240 for unit in units)
    cursor = 0
    for unit in units:
        assert unit['char_start'] == cursor
        assert text[unit['char_start']:unit['char_end']] == unit['text']
        cursor = unit['char_end']
    assert cursor == len(text)


def test_natural_lines_can_form_sixteen_beats_inside_old_four_coarse_blocks():
    text = ''.join(f'动作{i}：' + '文' * 17 + '\n' for i in range(34))
    units = split_shooting_source(text)
    assert len(units) == 34
    p = processor()
    value = structure()
    template = value['scenes'][0]['beats'][0]
    ends = list(range(2, 32, 2)) + [34]
    value['scenes'][0]['beats'] = [dict(template, source_end=end) for end in ends]
    p.llm.chat.return_value = json.dumps(value)
    snapshots = []
    p.plan_director_shooting_chunk(text, {},
        {'story_map': {'phases': [{'events': [{'event_id': 'event-cinema'}]}]}}, {},
        save_checkpoint=lambda value: snapshots.append(copy.deepcopy(value)) or True)
    assert p._plan_director_shooting_beat.call_count == 16
    assert ''.join(call.args[0] for call in p._plan_director_shooting_beat.call_args_list) == text
    assert all(len(call.args[0]) <= 480 for call in p._plan_director_shooting_beat.call_args_list)
    ids = [i for beat in snapshots[0]['structure']['scenes'][0]['beats'] for i in beat['source_unit_ids']]
    assert ids == list(range(34))


@pytest.mark.parametrize('ends,reason', [
    ([1, 1], '须大于前一边界'),
    ([2, 1], '须大于前一边界'),
    ([1, 3], '不超过2'),
    ([1], '末尾未完整覆盖'),
    ([0, 2], '须大于前一边界'),
    (['bad', 2], 'source_end'),
])
def test_invalid_boundaries_are_rejected_without_saving_or_shots(ends, reason):
    p = processor()
    value = structure()
    template = value['scenes'][0]['beats'][0]
    value['scenes'][0]['beats'] = [dict(template, source_end=end) for end in ends]
    p.llm.chat.return_value = json.dumps(value)
    save = Mock()
    with pytest.raises(RuntimeError, match=reason):
        generate(p, save_checkpoint=save)
    assert p.llm.chat.call_count == 2
    save.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()


def test_schema_and_boundary_errors_are_corrected_together_from_original_json():
    p = processor()
    value = structure()
    beat = value['scenes'][0]['beats'][1]
    beat['dramatic_penalty'] = beat.pop('dramatic_purpose')
    beat['source_end'] = 1
    rejected = json.dumps(value)
    p.llm.chat.side_effect = [rejected, json.dumps(structure())]
    generate(p)
    messages = p.llm.chat.call_args.kwargs['messages']
    assert messages[1] == {'role': 'assistant', 'content': rejected}
    assert '修正上条JSON' in messages[2]['content']
    for problem in ('dramatic_penalty', 'dramatic_purpose', '须大于前一边界', '末尾未完整覆盖'):
        assert problem in messages[0]['content']


def test_legacy_lists_are_rejected_instead_of_implicitly_converted():
    p = processor()
    value = structure()
    for beat in value['scenes'][0]['beats']:
        beat['source_unit_ids'] = [beat.pop('source_end') - 1]
    p.llm.chat.return_value = json.dumps(value)
    with pytest.raises(RuntimeError, match='source_end'):
        generate(p)
    p._plan_director_shooting_beat.assert_not_called()


def test_single_oversized_boundary_requires_more_beats():
    p = processor()
    value = structure()
    value['scenes'][0]['beats'] = [dict(value['scenes'][0]['beats'][0], source_end=3)]
    p.llm.chat.return_value = json.dumps(value)
    with pytest.raises(RuntimeError, match='480字符'):
        p.plan_director_shooting_chunk('文' * 600, {}, {}, {})
    p._plan_director_shooting_beat.assert_not_called()


def test_request_schema_and_examples_use_exclusive_boundaries():
    p = processor()
    generate(p)
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    schema = json.loads(prompt.split('<structure_schema>')[1].split('</structure_schema>')[0])
    field = schema['$defs']['StructureBeat']['properties']['source_end']
    assert field['minimum'] == 1 and field['maximum'] == 2
    assert 'source_unit_ids' not in schema['$defs']['StructureBeat']['properties']
    assert '最后一个必须为2' in prompt
    assert '跨场景也不重置' in prompt


def test_corrupted_checkpoint_cannot_skip_source_by_forging_internal_ranges():
    p = processor()
    snapshots = []
    generate(p, save_checkpoint=lambda value: snapshots.append(copy.deepcopy(value)) or True)
    state = snapshots[-1]
    state['structure']['scenes'][0]['beats'][0]['source_unit_ids'] = [1]
    p.llm.chat.reset_mock()
    p._plan_director_shooting_beat.reset_mock()
    with pytest.raises(ValueError, match='不连续'):
        generate(p, checkpoint=state)
    p.llm.chat.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()


def test_beams_container_typo_is_normalized_once_without_changing_values():
    p = processor()
    value = structure()
    value['scenes'][0]['beams'] = value['scenes'][0].pop('beats')
    raw = json.dumps(value)
    p.llm.chat.return_value = raw
    snapshots = []
    result = generate(p, save_checkpoint=lambda s: snapshots.append(copy.deepcopy(s)) or True)
    assert p.llm.chat.call_count == 1
    assert [b['title'] for b in result['scenes'][0]['beats']] == ['进入', '离开']
    assert p._plan_director_shooting_beat.call_args_list[0].args[0] == '进' * 240
    assert p._plan_director_shooting_beat.call_args_list[1].args[0] == '离' * 80
    assert snapshots[0]['structure_key_corrections'] == [
        {'path': 'scenes.0', 'from': 'beams', 'to': 'beats'}]
    assert json.dumps(value) == raw
    normalized, corrections = normalize_structure_containers(value)
    assert normalized == structure() and json.dumps(value) == raw
    assert corrections == snapshots[0]['structure_key_corrections']
    p.llm.chat.reset_mock()
    p._plan_director_shooting_beat.reset_mock()
    resumed = generate(p, checkpoint=snapshots[-1])
    assert resumed == result
    p.llm.chat.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()


def test_root_container_single_character_typo_uses_same_admission():
    p = processor()
    value = structure()
    value['scene'] = value.pop('scenes')
    p.llm.chat.return_value = json.dumps(value)
    snapshots = []
    generate(p, save_checkpoint=lambda s: snapshots.append(copy.deepcopy(s)) or True)
    assert p.llm.chat.call_count == 1
    assert snapshots[0]['structure_key_corrections'] == [{'path': '$', 'from': 'scene', 'to': 'scenes'}]


@pytest.mark.parametrize('kind', ['both', 'ambiguous', 'strings', 'bad_scene', 'boundary', 'purpose'])
def test_container_normalization_never_hides_other_contract_failures(kind):
    p = processor()
    value = structure()
    scene = value['scenes'][0]
    scene['beams'] = scene.pop('beats')
    if kind == 'both':
        scene['beats'] = copy.deepcopy(scene['beams'])
    elif kind == 'ambiguous':
        scene['bears'] = copy.deepcopy(scene['beams'])
    elif kind == 'strings':
        scene['beams'] = ['not a beat']
    elif kind == 'bad_scene':
        value['scenes'].append('not a scene')
    elif kind == 'boundary':
        scene['beams'][1]['source_end'] = 1
    else:
        beat = scene['beams'][0]
        beat['dramatic_penalty'] = beat.pop('dramatic_purpose')
    p.llm.chat.return_value = json.dumps(value)
    save = Mock()
    with pytest.raises(RuntimeError):
        generate(p, save_checkpoint=save)
    assert p.llm.chat.call_count == 2
    save.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()


def test_valid_container_normalization_still_retries_other_invalid_fields():
    p = processor()
    value = structure()
    value['scenes'][0]['beams'] = value['scenes'][0].pop('beats')
    value['scenes'].append('bad scene')
    corrected = structure()
    corrected['scenes'][0]['beams'] = corrected['scenes'][0].pop('beats')
    p.llm.chat.side_effect = [json.dumps(value), json.dumps(corrected)]
    generate(p)
    assert p.llm.chat.call_count == 2
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    assert 'scenes.1: model_type' in prompt
    assert 'scenes.0.beats: 缺少必填字段' not in prompt
    assert json.loads(p.llm.chat.call_args.kwargs['messages'][1]['content']) == value


def test_event_reference_schema_and_catalog_match_exact_input_ids():
    p = processor()
    generate(p)
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    schema = json.loads(prompt.split('<structure_schema>')[1].split('</structure_schema>')[0])
    assert schema['$defs']['StructureBeat']['properties']['story_event_ids']['items']['enum'] == ['event-cinema', 'unrelated-event']
    events = json.loads(prompt.split('<allowed_story_events>')[1].split('</allowed_story_events>')[0])
    assert [item['event_id'] for item in events] == ['event-cinema', 'unrelated-event']


def test_event_reference_errors_are_reported_alongside_bad_scene_and_boundary():
    p = processor()
    value = structure()
    value['scenes'].append('not a scene')
    value['scenes'][0]['beats'][0]['story_event_ids'] = ['invented-id']
    value['scenes'][0]['beats'][1]['source_end'] = 1
    rejected = json.dumps(value)
    p.llm.chat.side_effect = [rejected, json.dumps(structure())]
    generate(p)
    messages = p.llm.chat.call_args.kwargs['messages']
    prompt = messages[0]['content']
    assert 'scenes.1: model_type' in prompt
    assert 'scenes.0.beats.0.story_event_ids.0' in prompt
    refs = json.loads(prompt.split('<invalid_story_event_refs>')[1].split('</invalid_story_event_refs>')[0])
    assert refs == [{'path': 'scenes.0.beats.0.story_event_ids.0', 'value': 'invented-id'}]
    assert messages[1]['content'] == rejected
    assert p._plan_director_shooting_beat.call_count == 2


def test_reference_and_boundary_failures_are_returned_in_same_correction():
    p = processor()
    value = structure()
    value['scenes'][0]['beats'][0]['story_event_ids'] = ['event-CINEMA']
    value['scenes'][0]['beats'][1]['source_end'] = 1
    p.llm.chat.side_effect = [json.dumps(value), json.dumps(structure())]
    generate(p)
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    assert '末尾未完整覆盖' in prompt and 'scenes.0.beats.0.story_event_ids.0' in prompt


def test_unknown_event_id_is_never_dropped_or_guessed_and_is_not_logged(caplog):
    p = processor()
    value = structure()
    value['scenes'][0]['beats'][0]['story_event_ids'] = ['PRIVATE_UNKNOWN_EVENT_VALUE']
    p.llm.chat.return_value = json.dumps(value)
    save = Mock()
    with pytest.raises(RuntimeError, match='story_event_ids') as error:
        generate(p, save_checkpoint=save)
    assert 'PRIVATE_UNKNOWN_EVENT_VALUE' not in str(error.value)
    assert 'PRIVATE_UNKNOWN_EVENT_VALUE' not in caplog.text
    assert p.llm.chat.call_count == 2
    save.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()


def test_empty_event_catalog_only_permits_empty_references():
    p = processor()
    value = structure()
    for beat in value['scenes'][0]['beats']:
        beat['story_event_ids'] = []
    p.llm.chat.return_value = json.dumps(value)
    p.plan_director_shooting_chunk('进' * 240 + '离' * 80, {}, {}, {})
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    schema = json.loads(prompt.split('<structure_schema>')[1].split('</structure_schema>')[0])
    field = schema['$defs']['StructureBeat']['properties']['story_event_ids']
    assert field['maxItems'] == 0
    assert '<allowed_story_events>[]</allowed_story_events>' in prompt


def structure():
    scene = raw_scene()
    scene['beats'] = [
        {'title': '进入', 'dramatic_purpose': '建立关系', 'emotional_change': '平静',
         'source_end': 1, 'story_event_ids': ['event-cinema']},
        {'title': '离开', 'dramatic_purpose': '结束相遇', 'emotional_change': '不舍',
         'source_end': 2, 'story_event_ids': []},
    ]
    return {'scenes': [scene], 'unresolved_questions': []}

def processor():
    p = ScriptProcessor.__new__(ScriptProcessor)
    p.llm = Mock(is_configured=True)
    p.llm.chat.return_value = json.dumps(structure())
    p._plan_director_shooting_beat = Mock(return_value=valid_chunk())
    return p

def generate(p, **kwargs):
    # Each source unit is at most 240 characters, preserving the exact source.
    return p.plan_director_shooting_chunk(
        '进' * 240 + '离' * 80, {'characters': [], 'props': []},
        {'story_map': {'phases': [{'events': [{'event_id': 'event-cinema'},
                                             {'event_id': 'unrelated-event'}]}]}}, {}, **kwargs)

def test_completed_beats_resume_without_repeating_structure_or_paid_work():
    p = processor()
    snapshots = []
    p._plan_director_shooting_beat.side_effect = [valid_chunk(), RuntimeError('upstream error')]
    with pytest.raises(RuntimeError, match='upstream error'):
        generate(p, save_checkpoint=lambda value: snapshots.append(copy.deepcopy(value)) or True)
    assert len(snapshots) == 2  # Structure and first completed beat survive.
    assert snapshots[-1]['completed_steps'] == 2
    assert snapshots[-1]['total_steps'] == 3
    p.llm.chat.reset_mock()
    p._plan_director_shooting_beat.reset_mock(side_effect=True)
    p._plan_director_shooting_beat.return_value = valid_chunk()
    result = generate(p, checkpoint=snapshots[-1],
                      save_checkpoint=lambda value: snapshots.append(copy.deepcopy(value)) or True)
    p.llm.chat.assert_not_called()
    assert p._plan_director_shooting_beat.call_count == 1
    assert [beat['title'] for beat in result['scenes'][0]['beats']] == ['进入', '离开']
    assert snapshots[-1]['completed_steps'] == snapshots[-1]['total_steps'] == 3

def test_detail_request_contains_only_current_source_and_relevant_events():
    p = processor()
    generate(p, model='deepseek-v4.1-flash')
    calls = p._plan_director_shooting_beat.call_args_list
    assert [len(call.args[0]) for call in calls] == [240, 80]
    assert 'unrelated-event' not in json.dumps(calls[0].args[2])
    assert 'event-cinema' in json.dumps(calls[0].args[2])
    assert all(call.kwargs['model'] == 'deepseek-v4.1-flash' for call in calls)
    assert p.llm.chat.call_args.kwargs['model'] == 'deepseek-v4.1-flash'

def test_changed_input_does_not_reuse_checkpoint():
    p = processor()
    snapshots = []
    generate(p, save_checkpoint=lambda value: snapshots.append(copy.deepcopy(value)) or True)
    p.llm.chat.reset_mock()
    generate(p, checkpoint=snapshots[-1], model='different-model')
    assert p.llm.chat.call_count == 1

def test_checkpoint_rejection_stops_before_next_model_call():
    p = processor()
    with pytest.raises(RuntimeError, match='过期'):
        generate(p, save_checkpoint=lambda value: False)
    p._plan_director_shooting_beat.assert_not_called()

@pytest.mark.parametrize('labels,expected', [
    ({'scene_ref': '场景二·门外', 'location': '门外'}, '场景二·门外'),
    ({'location': '门外'}, '门外'),
    ({}, ''),
])
def test_missing_second_scene_heading_uses_existing_label_without_model_retry(labels, expected):
    p = processor()
    value = structure()
    second_scene = {'beats': [value['scenes'][0]['beats'].pop()], **labels}
    value['scenes'].append(second_scene)
    p.llm.chat.return_value = json.dumps(value)
    snapshots = []
    result = generate(p, save_checkpoint=lambda state: snapshots.append(copy.deepcopy(state)) or True)
    assert p.llm.chat.call_count == 1
    assert p._plan_director_shooting_beat.call_count == 2
    assert result['scenes'][1]['heading'] == expected
    assert result['scenes'][1]['beats'][0]['title'] == '离开'
    assert snapshots[0]['structure']['scenes'][1]['heading'] == expected
    assert snapshots[-1]['completed_steps'] == snapshots[-1]['total_steps'] == 3

def test_missing_label_does_not_admit_missing_beats_or_source_coverage():
    p = processor()
    value = structure()
    value['scenes'].append({'location': '门外'})
    p.llm.chat.return_value = json.dumps(value)
    with pytest.raises(RuntimeError):
        generate(p)
    assert p.llm.chat.call_count == 2
    p._plan_director_shooting_beat.assert_not_called()

def test_structure_correction_reports_all_missing_fields_in_one_attempt():
    p = processor()
    value = structure()
    for beat in value['scenes'][0]['beats']:
        del beat['source_end']
    p.llm.chat.side_effect = [json.dumps(value), json.dumps(structure())]
    generate(p)
    repair_prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    assert 'scenes.0.beats.0.source_end' in repair_prompt
    assert 'scenes.0.beats.1.source_end' in repair_prompt
    assert '缺少必填字段' in repair_prompt

def test_structure_request_bounds_scene_and_beat_counts_by_input_units():
    p = processor()
    generate(p)
    prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    schema = json.loads(prompt.split('<structure_schema>')[1].split('</structure_schema>')[0])
    assert schema['properties']['scenes']['maxItems'] == 2
    assert schema['$defs']['StructureScene']['properties']['beats']['maxItems'] == 2
    assert '全部场景合计最多2个节拍' in prompt
    assert 'dramatic_purpose是戏剧目的' in prompt

def test_typo_is_not_locally_renamed_or_saved_when_provider_does_not_fix_it():
    p = processor()
    invalid = structure()
    invalid['scenes'][0]['beats'][0]['dramatic_penalty'] = invalid['scenes'][0]['beats'][0].pop('dramatic_purpose')
    p.llm.chat.return_value = json.dumps(invalid)
    save = Mock()
    with pytest.raises(RuntimeError, match='dramatic_purpose'):
        generate(p, save_checkpoint=save)
    assert p.llm.chat.call_count == 2
    save.assert_not_called()
    p._plan_director_shooting_beat.assert_not_called()

def test_oversized_rejected_output_is_not_fed_back_into_retry():
    p = processor()
    invalid = structure()
    invalid['scenes'][0]['beats'][0]['dramatic_purpose'] = 'X' * 17000
    p.llm.chat.side_effect = [json.dumps(invalid), json.dumps(structure())]
    generate(p)
    messages = p.llm.chat.call_args.kwargs['messages']
    assert len(messages) == 2
    assert 'X' * 17000 not in json.dumps(messages)

def test_each_detail_call_repairs_only_the_current_beat_and_enforces_shot_budget():
    p = ScriptProcessor.__new__(ScriptProcessor)
    p.llm = Mock(is_configured=True)
    detail = {'shots': valid_chunk()['scenes'][0]['beats'][0]['shots'],
              'continuity_out': '', 'unresolved_questions': []}
    too_many = dict(detail, shots=detail['shots'] * 4)
    p.llm.chat.side_effect = [json.dumps(structure()), json.dumps(too_many),
                             json.dumps(detail), json.dumps(detail)]
    result = generate(p)
    assert len(result['scenes'][0]['beats']) == 2
    assert p.llm.chat.call_count == 4
    repair_prompt = p.llm.chat.call_args_list[2].kwargs['messages'][0]['content']
    assert '1–3 个 shots' in repair_prompt
    assert '离' * 80 not in repair_prompt

def test_pipeline_persists_structure_and_detail_checkpoints_through_real_job_store(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from src.apps.comic_gen.extraction_jobs import ExtractionJobs
    from tests.test_extraction_jobs import wait_done

    pipeline, script = make_pipeline()
    p = ScriptProcessor.__new__(ScriptProcessor)
    p.llm = Mock(is_configured=True)
    skeleton = structure()
    skeleton['scenes'][0]['beats'] = skeleton['scenes'][0]['beats'][:1]
    skeleton['scenes'][0]['beats'][0]['source_end'] = len(split_shooting_source(script.original_text))
    provider_error = RuntimeError('private provider body')
    provider_error.llm_diagnostic = {'stream': True, 'text_chars': 100, 'elapsed_seconds': 154}
    detail = {'shots': valid_chunk()['scenes'][0]['beats'][0]['shots'], 'unresolved_questions': []}
    p.llm.chat.side_effect = [json.dumps(skeleton), provider_error, json.dumps(detail)]
    pipeline.script_processor = p
    fingerprint = 'director_shooting_plan:stages-test'
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)

        def work(job_id):
            plan = pipeline.preview_director_shooting_plan(
                'film',
                load_batches=lambda: store.load_batches('owner', 'project', fingerprint),
                save_batch=lambda index, ref, frames: store.save_batch(
                    'owner', 'project', fingerprint, job_id, index, ref, frames))
            return {'plan': plan.model_dump()}

        failed = wait_done(store, store.start('owner', 'project', fingerprint, work,
                                              total_batches=1, pass_job_id=True))
        assert failed['status'] == 'failed'
        assert failed['progress'] == {'completed': 1, 'total': 2}
        assert '场景 1 节拍 1' in failed['error']
        assert '流式响应中断' in failed['error']
        assert 'private' not in json.dumps(failed)
        assert failed['result']['provider_response']['elapsed_seconds'] == 154
        reloaded = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)
        assert reloaded.get('owner', 'project', failed['id'])['progress'] == failed['progress']
        completed = wait_done(store, store.start('owner', 'project', fingerprint, work,
                                                 total_batches=1, pass_job_id=True))
        assert completed['status'] == 'completed', completed
        assert completed['progress'] == {'completed': 2, 'total': 2}
        assert completed['result']['plan']['scenes'][0]['beats'][0]['title'] == '进入'
        assert p.llm.chat.call_count == 3  # No second structure request after reload.
