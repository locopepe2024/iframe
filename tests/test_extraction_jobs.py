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
