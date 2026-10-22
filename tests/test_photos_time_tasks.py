from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from PIL import Image
import pytest

from tests.test_photos_analysis import setup
from src.apps.photos.time_tasks import PhotoTaskStore
from src.apps.photos.dates import PhotoTimeEvidence, ExifCaptureTime
from src.apps.identity import UserContext, require_user_context


def prepare(setup):
    client, original, app, path = setup
    store = PhotoTaskStore(original.path, initialize=False)
    batch = client.get('/photos/albums').json()['photos'][0]['batch_id']
    store.register_photo('owner', batch, 'second', PhotoTimeEvidence(original_capture_times=(
        ExifCaptureTime(source_ref='test', raw_value='1985:06:07 08:09:10'),)))
    q = client.post(f'/photos/batches/{batch}/time-question').json()
    version = client.post(f'/photos/batches/{batch}/time-consent', json=dict(
        question_id=q['question_id'], granted=True, method='button')).json()['consent_version']
    return client, store, app, path, batch, version


def test_durable_mixed_results_idempotency_owner_and_no_get_execution(setup):
    client, store, app, path, batch, version = prepare(setup)
    endpoint = f'/photos/batches/{batch}/time-tasks'
    body = dict(operation_id='first', consent_version=version)
    task = client.post(endpoint, json=body)
    assert task.status_code == 202
    task = task.json()
    assert task['status'] == 'queued' and task['counts']['pending'] == 2
    assert client.post(endpoint, json=body).json() == task
    assert client.post(endpoint, json={**body, 'operation_id':'duplicate-active'}).status_code == 409
    assert client.get('/photos/tasks/' + task['task_id']).json() == task
    assert client.get(path + '/date').json()['reason'] == 'not_processed'
    assert store.process_time_item()
    # New process/store continues pending work without browser presence.
    recovered = PhotoTaskStore(store.path, initialize=False)
    assert recovered.process_time_item()
    assert not recovered.process_time_item()
    done = client.get('/photos/tasks/' + task['task_id']).json()
    assert done['status'] == 'needs_confirmation'
    assert done['counts'] == dict(pending=0, completed=1, needs_confirmation=1, failed=0, cancelled=0)
    assert client.post(endpoint, json=body).json() == done
    assert client.get('/photos/second/date').json()['date']['value'].startswith('1985-06-07')
    assert len(client.get('/photos/second/date/history').json()['changes']) == 2
    app.dependency_overrides[require_user_context] = lambda: UserContext('other','other','','')
    assert client.get('/photos/tasks/' + task['task_id']).status_code == 404
    assert client.get(endpoint).status_code == 404
    assert client.post(endpoint, json=body).status_code == 404


def test_revision_change_failure_retry_and_human_date_preserved(setup):
    client, store, _, path, batch, version = prepare(setup)
    endpoint = f'/photos/batches/{batch}/time-tasks'
    task = client.post(endpoint, json=dict(operation_id='first', consent_version=version)).json()
    assert client.patch(path + '/date', json=dict(operation_id='correct', expected_revision=1,
        consent_version=version, value='1970', precision='year')).status_code == 200
    while store.process_time_item():
        pass
    done = store.time_task('owner', task['task_id'])
    assert done['status'] == 'partial_failed' and done['counts']['failed'] == 1
    assert next(row for row in done['items'] if row['status']=='failed')['error_code'] == 'revision_changed'
    retry = client.post(endpoint, json=dict(operation_id='retry', consent_version=version, retry_task_id=task['task_id'])).json()
    assert len(retry['items']) == 1
    assert store.process_time_item()
    assert store.time_task('owner', retry['task_id'])['status'] == 'completed'
    assert client.get(path + '/date').json()['date']['value'] == '1970'
    assert len(client.get(path + '/date/history').json()['changes']) == 2


def test_revoke_cancels_pending_and_new_authorization_cannot_resurrect_old_task(setup):
    client, store, _, path, batch, version = prepare(setup)
    endpoint = f'/photos/batches/{batch}/time-tasks'
    task = client.post(endpoint, json=dict(operation_id='first', consent_version=version)).json()
    assert store.process_time_item()
    before = {item['photo_id']:client.get('/photos/'+item['photo_id']+'/date').json() for item in task['items']}
    assert client.post(f'/photos/batches/{batch}/revoke-time', json=dict(expected_consent_version=version)).status_code == 200
    cancelled = store.time_task('owner',task['task_id'])
    assert cancelled['status'] == 'cancelled' and cancelled['counts']['cancelled'] == 1
    assert not store.process_time_item()
    assert client.post(endpoint, json=dict(operation_id='stale', consent_version=version)).status_code == 403
    q = client.post(f'/photos/batches/{batch}/time-question').json()
    client.post(f'/photos/batches/{batch}/time-consent', json=dict(question_id=q['question_id'],granted=True,method='button'))
    assert not store.process_time_item()
    for photo_id, annotation in before.items():
        assert client.get('/photos/'+photo_id+'/date').json() == annotation


def test_concurrent_workers_commit_items_once(setup):
    client, store, _, _, batch, version = prepare(setup)
    task = client.post(f'/photos/batches/{batch}/time-tasks', json=dict(operation_id='first',consent_version=version)).json()
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert all(pool.map(lambda _: store.process_time_item(), range(2)))
    assert not store.process_time_item()
    assert store.time_task('owner',task['task_id'])['counts']['pending'] == 0
    assert len(client.get('/photos/second/date/history').json()['changes']) == 2


def test_item_transaction_rolls_back_date_and_progress_on_process_failure(setup, monkeypatch):
    client, store, _, _, batch, version = prepare(setup)
    task = client.post(f'/photos/batches/{batch}/time-tasks', json=dict(operation_id='first',consent_version=version)).json()
    original = store._change_in_connection
    def interrupted(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError('simulated worker termination before commit')
    monkeypatch.setattr(store, '_change_in_connection', interrupted)
    with pytest.raises(RuntimeError):
        store.process_time_item()
    assert store.time_task('owner',task['task_id']) == task
    assert len(client.get('/photos/second/date/history').json()['changes']) == 1
    recovered = PhotoTaskStore(store.path, initialize=False)
    while recovered.process_time_item():
        pass
    assert recovered.time_task('owner',task['task_id'])['counts']['pending'] == 0
