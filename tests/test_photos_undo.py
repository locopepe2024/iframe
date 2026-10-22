from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest

from tests.test_photos_time_tasks import setup, prepare
from src.apps.identity import UserContext, require_user_context
from src.apps.photos.undo import PhotoUndoStore
from src.apps.photos.date_store import DateStore, _SCHEMA


def test_preview_undo_preserves_user_date_originals_and_other_batches(setup):
    client, worker, app, path, batch, version = prepare(setup)
    from src.apps.photos.dates import PhotoTimeEvidence
    worker.register_photo('owner', 'unrelated', 'unrelated-photo', PhotoTimeEvidence())
    unrelated = client.get('/photos/unrelated-photo/date').json()
    raw = client.get(path + '/original').content
    task = client.post(f'/photos/batches/{batch}/time-tasks', json=dict(operation_id='task',consent_version=version)).json()
    while worker.process_time_item():
        pass
    assert client.patch(path + '/date', json=dict(operation_id='manual',expected_revision=2,consent_version=version,value='1970',precision='year')).status_code == 200
    before = client.get(path + '/date').json()
    preview_path = f'/photos/batches/{batch}/undo-time-preview'
    preview = client.get(preview_path).json()
    assert preview['counts'] == dict(undo=1,preserve=1)
    second = next(item for item in preview['items'] if item['photo_id']=='second')
    assert second['current']['date']['value'].startswith('1985')
    assert second['target']['reason'] == 'not_processed'
    assert client.get('/photos/second/date').json()['revision'] == 2  # preview is read only
    endpoint = f'/photos/batches/{batch}/undo-time'
    body = dict(operation_id='undo-first',preview_token=preview['preview_token'])
    result = client.post(endpoint,json=body)
    assert result.status_code == 200
    assert result.json()['counts'] == dict(undo=1,preserve=1)
    assert client.post(endpoint,json=body).json() == result.json()
    assert client.post(endpoint,json={**body,'preview_token':'0'*64}).status_code == 409
    assert client.get(path+'/date').json() == before
    assert client.get('/photos/unrelated-photo/date').json() == unrelated
    assert client.get(path+'/original').content == raw
    after = client.get('/photos/second/date').json()
    assert after['date'] is None and after['revision']==3 and after['reason']=='not_processed'
    history = client.get('/photos/second/date/history').json()['changes']
    assert [row['kind'] for row in history] == ['register','organize','undo']
    assert history[-1]['restored_from_revision']==1
    assert client.get('/photos/albums?year=1985').json()['photos']==[]
    assert client.get(f'/photos/batches/{batch}').json()['granted'] is False
    assert client.get('/photos/tasks/'+task['task_id']).json()['status']=='needs_confirmation'
    assert client.get(preview_path).json()['counts']==dict(undo=0,preserve=2)
    assert client.get(endpoint+'/history').json()['changes']==[result.json()]
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert client.get(preview_path).status_code==404
    assert client.post(endpoint,json=body).status_code==404
    assert client.get(endpoint+'/history').status_code==404


def test_stale_preview_rejected_atomically_and_undo_fences_queued_work(setup):
    client, worker, _, path, batch, version=prepare(setup)
    endpoint=f'/photos/batches/{batch}/undo-time'
    preview=client.get(endpoint+'-preview').json()
    task=client.post(f'/photos/batches/{batch}/time-tasks',json=dict(operation_id='first',consent_version=version)).json()
    worker.process_time_item()
    before={item['photo_id']:client.get('/photos/'+item['photo_id']+'/date').json() for item in task['items']}
    assert client.post(endpoint,json=dict(operation_id='stale',preview_token=preview['preview_token'])).status_code==409
    assert client.get(f'/photos/batches/{batch}').json()['granted'] is True
    for photo, date in before.items():
        assert client.get('/photos/'+photo+'/date').json()==date
    fresh=client.get(endpoint+'-preview').json()
    assert client.post(endpoint,json=dict(operation_id='fresh',preview_token=fresh['preview_token'])).status_code==200
    assert worker.time_task('owner',task['task_id'])['status']=='cancelled'
    assert not worker.process_time_item()
    assert client.get(endpoint+'/history').json()['changes'][0]['operation_id']=='fresh'


def test_undo_rollback_and_concurrent_retries(setup, monkeypatch):
    client, worker, _, _, batch, version=prepare(setup)
    client.post(f'/photos/batches/{batch}/time-tasks',json=dict(operation_id='first',consent_version=version))
    while worker.process_time_item():
        pass
    store=PhotoUndoStore(worker.path,initialize=False)
    preview=store.undo_preview('owner',batch)
    original=store._record
    def fail(*args,**kwargs):
        original(*args,**kwargs)
        raise RuntimeError('transaction failure')
    monkeypatch.setattr(store,'_record',fail)
    with pytest.raises(RuntimeError):
        store.undo_batch('owner',batch,'actor',preview_token=preview['preview_token'],operation_id='undo')
    assert store.undo_preview('owner',batch)==preview
    assert store.undo_history('owner',batch)['changes']==[]
    monkeypatch.setattr(store,'_record',original)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:store.undo_batch('owner',batch,'actor',preview_token=preview['preview_token'],operation_id='undo'),range(2)))
    assert results[0]==results[1]
    assert len(store.history('owner','second'))==3


def test_migrate_pre_undo_schema_preserves_history(tmp_path):
    path=tmp_path/'old.db'
    with sqlite3.connect(path) as connection:
        connection.executescript(_SCHEMA.replace("'organize', 'undo'", "'organize'"))
    from src.apps.photos.dates import PhotoTimeEvidence
    DateStore(path,initialize=False).register_photo('owner','batch','photo',PhotoTimeEvidence())
    store=PhotoUndoStore(path)
    assert len(store.history('owner','photo'))==1
    with store._connection() as connection:
        assert "'undo'" in connection.execute("SELECT sql FROM sqlite_master WHERE name='photo_date_history'").fetchone()[0]
    PhotoUndoStore(path)
    assert len(store.history('owner','photo'))==1


def test_restore_preserved_then_regrant_organize_and_undo_again(setup):
    client, worker, _, path, batch, version = prepare(setup)
    endpoint = f'/photos/batches/{batch}'
    client.post(endpoint+'/time-tasks', json=dict(operation_id='first', consent_version=version))
    while worker.process_time_item():
        pass
    assert client.post('/photos/second/date/restore', json=dict(operation_id='restore',
        expected_revision=2, consent_version=version, target_revision=1)).status_code == 200
    preserved = client.get('/photos/second/date').json()
    preview = client.get(endpoint+'/undo-time-preview').json()
    assert preview['counts'] == dict(undo=1, preserve=1)
    assert client.post(endpoint+'/undo-time', json=dict(operation_id='undo-one', preview_token=preview['preview_token'])).status_code == 200
    assert client.get('/photos/second/date').json() == preserved
    question = client.post(endpoint+'/time-question').json()
    version = client.post(endpoint+'/time-consent', json=dict(question_id=question['question_id'], granted=True, method='button')).json()['consent_version']
    client.post(endpoint+'/time-tasks', json=dict(operation_id='second', consent_version=version))
    while worker.process_time_item():
        pass
    preview = client.get(endpoint+'/undo-time-preview').json()
    # Re-running an unchanged EXIF result is a no-op, retaining the explicit restore.
    assert preview['counts'] == dict(undo=1, preserve=1)
    assert client.post(endpoint+'/undo-time', json=dict(operation_id='undo-two', preview_token=preview['preview_token'])).status_code == 200
    restored = client.get('/photos/second/date').json()
    assert {k:v for k,v in restored.items() if k!='revision'} == {k:v for k,v in preserved.items() if k!='revision'}
    first_page = client.get(endpoint+'/undo-time/history?limit=1').json()
    assert first_page['next_after'] == 1
    assert first_page['changes'][0]['operation_id'] == 'undo-one'
    assert client.get(endpoint+'/undo-time/history?after=1&limit=1').json()['changes'][0]['operation_id'] == 'undo-two'
