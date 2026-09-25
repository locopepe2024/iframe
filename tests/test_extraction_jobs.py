from contextvars import ContextVar
from concurrent.futures import ThreadPoolExecutor
from threading import Event
import time
import pytest
from fastapi import HTTPException
from src.apps.comic_gen.extraction_jobs import ExtractionJobs


def wait_done(store, job):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = store.get('owner', 'project', job['id'])
        if result['status'] != 'running': return result
        time.sleep(.01)
    pytest.fail('Worker did not finish')


def test_immediate_deduplicated_durable_and_owner_scoped(tmp_path):
    gate = Event(); calls = []; context = ContextVar('test_owner', default=None); context.set('owner')
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)
        def work():
            calls.append(context.get()); gate.wait(2); return {'characters': [{'name': 'A'}]}
        job = store.start('owner', 'project', 'key', work)
        assert job['status'] == 'running'
        assert store.start('owner', 'project', 'key', work)['id'] == job['id']
        with pytest.raises(HTTPException) as error: store.get('other', 'project', job['id'])
        assert error.value.status_code == 404
        with pytest.raises(HTTPException) as error: store.start('owner', 'project', 'different', work)
        assert error.value.status_code == 409
        gate.set(); done = wait_done(store, job)
        assert done['status'] == 'completed' and done['result']['characters'][0]['name'] == 'A'
        reloaded = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)
        assert reloaded.start('owner', 'project', 'key', work)['id'] == job['id']
        assert calls == ['owner']


def test_failure_is_explicit_and_retryable(tmp_path):
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)
        def fail(): raise RuntimeError('provider rejected request')
        job = store.start('owner', 'project', 'key', fail)
        assert wait_done(store, job)['status'] == 'failed'
        retry = store.start('owner', 'project', 'key', lambda: {})
        assert retry['id'] != job['id']
    assert wait_done(store, retry)['status'] == 'completed'


def test_interrupted_job_is_failed_and_can_be_retried_after_restart(tmp_path):
    path = tmp_path / 'jobs.db'
    store = ExtractionJobs(path)
    with store.connect() as db:
        db.execute(
            "INSERT INTO jobs (id, owner, project, fingerprint, status, created, result, error) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
            ('interrupted', 'owner', 'project', 'key', 'running', time.time()),
        )

    assert store.recover_interrupted() == 1
    assert store.get('owner', 'project', 'interrupted')['status'] == 'failed'
    retry = store.start('owner', 'project', 'key', lambda: {'frames': []})
    assert retry['id'] != 'interrupted'
    assert wait_done(store, retry)['status'] == 'completed'


def test_timed_out_storyboard_job_can_retry_and_late_result_is_discarded(tmp_path):
    gate = Event()
    started = Event()
    with ThreadPoolExecutor(max_workers=2) as executor:
        store = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)

        def slow_work():
            started.set()
            gate.wait(2)
            return {'frames': ['stale']}

        old = store.start('owner', 'project', 'storyboard:revision', slow_work)
        assert started.wait(1)
        with store.connect() as db:
            db.execute('UPDATE jobs SET created=? WHERE id=?', (time.time() - 1801, old['id']))

        try:
            expired = store.get('owner', 'project', old['id'])
            assert expired['status'] == 'failed'
            assert '超时' in expired['error']
            retry = store.start('owner', 'project', 'storyboard:revision', lambda: {'frames': ['fresh']})
            assert retry['id'] != old['id']
            assert wait_done(store, retry)['result'] == {'frames': ['fresh']}
        finally:
            gate.set()

    assert store.get('owner', 'project', old['id'])['status'] == 'failed'


def test_storyboard_batches_survive_restart_and_reject_stale_workers(tmp_path):
    path = tmp_path / 'jobs.db'
    store = ExtractionJobs(path)
    with store.connect() as db:
        db.execute(
            "INSERT INTO jobs (id, owner, project, fingerprint, status, created) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ('old', 'owner', 'project', 'storyboard:same', 'running', time.time()),
        )
    assert store.save_batch('owner', 'project', 'storyboard:same', 'old', 0, 'source:chars-0-4', [{'action_summary': 'first'}])
    assert store.recover_interrupted() == 1
    restored = ExtractionJobs(path)
    assert restored.load_batches('owner', 'project', 'storyboard:same')[0]['frames'][0]['action_summary'] == 'first'
    assert not restored.save_batch('owner', 'project', 'storyboard:same', 'old', 1, 'source:chars-4-8', [{'action_summary': 'late'}])
    assert restored.load_batches('owner', 'project', 'storyboard:changed') == {}


def test_storyboard_job_progress_and_resume_after_failed_batch(tmp_path):
    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / 'jobs.db', executor=executor)

        def first(job_id):
            assert store.save_batch('owner', 'project', 'storyboard:same', job_id, 0,
                                    'source:chars-0-4', [{'action_summary': 'first'}])
            raise RuntimeError('second batch failed')

        job = store.start('owner', 'project', 'storyboard:same', first,
                          pass_job_id=True, total_batches=2)
        failed = wait_done(store, job)
        assert failed['status'] == 'failed'
        assert failed['progress'] == {'completed': 1, 'total': 2}
        assert '已保存' in failed['error']

        def resume(job_id):
            cached = store.load_batches('owner', 'project', 'storyboard:same')
            assert list(cached) == [0]
            assert store.save_batch('owner', 'project', 'storyboard:same', job_id, 1,
                                    'source:chars-4-8', [{'action_summary': 'second'}])
            return {'frames': cached[0]['frames'] + [{'action_summary': 'second'}]}

        retry = store.start('owner', 'project', 'storyboard:same', resume,
                            pass_job_id=True, total_batches=2)
        done = wait_done(store, retry)
        assert done['status'] == 'completed'
        assert done['progress'] == {'completed': 2, 'total': 2}
        assert [frame['action_summary'] for frame in done['result']['frames']] == ['first', 'second']


def test_lifo_latest_wins_queue_discards_older_director_revisions(tmp_path):
    first_started = Event()
    release_first = Event()
    calls = []

    with ThreadPoolExecutor(max_workers=1) as executor:
        store = ExtractionJobs(tmp_path / 'lifo-jobs.db', executor=executor)

        def first_work():
            calls.append('first')
            first_started.set()
            release_first.wait(10)
            return {'version': 'first'}

        first = store.start(
            'owner', 'project', 'director-first', first_work,
            queue_policy='fifo', queue_group='director',
        )
        assert first_started.wait(1)

        older = store.start(
            'owner', 'project', 'director-older',
            lambda: calls.append('older') or {'version': 'older'},
            queue_policy='lifo', queue_group='director',
        )
        latest = store.start(
            'owner', 'project', 'director-latest',
            lambda: calls.append('latest') or {'version': 'latest'},
            queue_policy='lifo', queue_group='director',
        )

        assert older['status'] == 'queued'
        assert latest['status'] == 'queued'
        assert store.get('owner', 'project', older['id'])['status'] == 'superseded'

        release_first.set()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            completed = store.get('owner', 'project', latest['id'])
            if completed['status'] == 'completed':
                break
            time.sleep(.01)
        else:
            pytest.fail('latest Director revision did not finish')

        assert calls == ['first', 'latest']
        assert store.get('owner', 'project', first['id'])['status'] == 'superseded'
        assert completed['result'] == {'version': 'latest'}


def test_api_returns_before_worker_and_resumes_persisted_preview(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    monkeypatch.setenv('IFRAME_DATA_DIR', str(tmp_path / 'config'))
    monkeypatch.chdir(tmp_path)
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import Script, Character
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user
    gate = Event()
    user = UserContext('owner', 'owner', '', '')
    source = Script(id='project', title='Test', original_text='text', owner_profile_id='owner', created_at=1, updated_at=1)
    result = Script(id='result', title='Test', original_text='text', created_at=1, updated_at=1, characters=[Character(id='actor', name='A', description='Actor')])
    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / 'api-jobs.db', executor=executor)
        def parse(*args): gate.wait(2); return result
        pipeline = SimpleNamespace(scripts={source.id: source}, series_store={}, _extraction_cache={},
            script_processor=SimpleNamespace(llm=SimpleNamespace(provider='openai', _get_default_model=lambda: 'test'), parse_novel=parse))
        monkeypatch.setattr(api, 'pipeline', pipeline)
        monkeypatch.setattr(api, 'extraction_jobs', jobs)
        monkeypatch.setattr(api, '_resolve_request_context', lambda *args: (user, False))
        api.app.dependency_overrides[require_studio_user] = lambda: user
        try:
            with TestClient(api.app) as client:
                path = f'/projects/{source.id}/extraction-jobs'
                response = client.post(path, json={'text':'text'})
                assert response.status_code == 202 and response.json()['status'] == 'running'
                assert client.post(path, json={'text':'text'}).json()['id'] == response.json()['id']
                gate.set()
                job_id = response.json()['id']
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    status = client.get(path + '/' + job_id)
                    if status.json()['status'] == 'completed': break
                    time.sleep(.01)
                assert status.json()['result']['characters'][0]['name'] == 'A'
                pipeline._extraction_cache.clear()
                assert client.get(path + '/' + job_id).status_code == 200
                assert pipeline._extraction_cache[source.id][1].original_text == 'text'
                assert client.get('/projects/not-owned/extraction-jobs/' + job_id).status_code == 404
        finally:
            api.app.dependency_overrides.pop(require_studio_user, None)
            gate.set()


def test_refinement_job_forwards_current_draft_and_accumulated_instructions(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import Script, Character
    from src.apps.identity import UserContext

    user = UserContext('owner', 'owner', '', '')
    source = Script(id='project', title='Test', original_text='source text', owner_profile_id='owner', created_at=1, updated_at=1)
    refined = Script(id='draft', title='Test', original_text='source text', created_at=1, updated_at=1,
                     characters=[Character(id='actor', name='主播', description='25岁马来女性')])
    captured = {}
    processor = SimpleNamespace(
        llm=SimpleNamespace(provider='openai', _get_default_model=lambda: 'test'),
        refine_entity_extraction=lambda title, text, draft, instructions, prompt: (
            captured.update(title=title, text=text, draft=draft, instructions=instructions, prompt=prompt) or refined
        ),
    )
    pipeline = SimpleNamespace(scripts={source.id: source}, _extraction_cache={}, script_processor=processor)
    with ThreadPoolExecutor(max_workers=1) as executor:
        jobs = ExtractionJobs(tmp_path / 'refine-jobs.db', executor=executor)
        monkeypatch.setattr(api, 'pipeline', pipeline)
        monkeypatch.setattr(api, 'extraction_jobs', jobs)
        request = api.ExtractionRefineRequest(
            text='source text',
            draft={'characters': [{'name': '女主播'}], 'scenes': [], 'props': []},
            instructions=['不要提取路人', '把女主播补充为马来女性'],
        )

        job = api.start_extraction_refinement('project', request, user)
        done = wait_done(jobs, job)
        response = api.extraction_response(done, 'project')

    assert captured['draft']['characters'][0]['name'] == '女主播'
    assert captured['instructions'] == ['不要提取路人', '把女主播补充为马来女性']
    assert response['result']['characters'][0]['name'] == '主播'
    assert pipeline.scripts['project'].characters == []
    assert pipeline._extraction_cache['project'][1].characters[0].name == '主播'


def test_refinement_prompt_contains_source_draft_and_all_user_constraints():
    from unittest.mock import Mock
    from src.apps.comic_gen.llm import ScriptProcessor

    processor = ScriptProcessor.__new__(ScriptProcessor)
    processor.llm = Mock(is_configured=True)
    processor.llm.chat.return_value = '{"characters": [], "scenes": [], "props": []}'

    result = processor.refine_entity_extraction(
        'Test',
        '原始剧本',
        {'characters': [{'name': '路人'}], 'scenes': [], 'props': []},
        ['删除路人', '增加产品别名穿心莲'],
    )

    prompt = processor.llm.chat.call_args.kwargs['messages'][0]['content']
    assert '原始剧本' in prompt
    assert '"name": "路人"' in prompt
    assert '1. 删除路人' in prompt and '2. 增加产品别名穿心莲' in prompt
    assert result.characters == []
