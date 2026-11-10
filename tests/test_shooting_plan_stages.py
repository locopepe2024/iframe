import copy
import json
from unittest.mock import Mock

import pytest

from src.apps.comic_gen.llm import ScriptProcessor
from tests.test_director_shooting_plan import make_pipeline, raw_scene, valid_chunk


def structure():
    scene = raw_scene()
    scene['beats'] = [
        {'title': '进入', 'dramatic_purpose': '建立关系', 'emotional_change': '平静',
         'source_unit_ids': [0], 'story_event_ids': ['event-cinema']},
        {'title': '离开', 'dramatic_purpose': '结束相遇', 'emotional_change': '不舍',
         'source_unit_ids': [1], 'story_event_ids': []},
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


@pytest.mark.parametrize('ids', [[0, 0], [1, 0], [0], [0, 1, 2]])
def test_structure_cannot_duplicate_skip_reorder_or_invent_source_units(ids):
    p = processor()
    invalid = structure()
    invalid['scenes'][0]['beats'] = [dict(invalid['scenes'][0]['beats'][0], source_unit_ids=ids)]
    p.llm.chat.return_value = json.dumps(invalid)
    with pytest.raises(RuntimeError):
        generate(p)
    assert p.llm.chat.call_count == 2
    p._plan_director_shooting_beat.assert_not_called()


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
        del beat['source_unit_ids']
    p.llm.chat.side_effect = [json.dumps(value), json.dumps(structure())]
    generate(p)
    repair_prompt = p.llm.chat.call_args.kwargs['messages'][0]['content']
    assert 'scenes.0.beats.0.source_unit_ids' in repair_prompt
    assert 'scenes.0.beats.1.source_unit_ids' in repair_prompt
    assert '缺少必填字段' in repair_prompt


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
