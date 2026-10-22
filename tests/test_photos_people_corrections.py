"""Behavioral coverage of manual curation and source-scoped undo."""
from concurrent.futures import ThreadPoolExecutor
import json

import pytest

from tests.test_photos_analysis import setup
from tests.test_photos_people_review import prepared, review_body
from src.apps.photos.people_corrections import PhotoPeopleCorrectionStore
from src.apps.identity import UserContext, require_user_context


def confirmed(setup, monkeypatch):
    client, base, app, batch, task, path = prepared(setup, monkeypatch)
    store = PhotoPeopleCorrectionStore(base.path, initialize=False)
    store.prepare_people_candidates('owner', task)
    people = []
    for group in store.people_groups('owner', task)['groups']:
        result = client.post(f"/photos/people-groups/{group['group_id']}/review", json=review_body(group)).json()
        photos = client.get('/photos/people-albums/'+result['person_id']).json()['photos']
        people.append((result['person_id'], [m for p in photos for m in p['members']]))
    return client, store, app, batch, sorted(people, key=lambda p:len(p[1])), path


def select(action, person='', faces=(), **extra):
    return dict(action=action, person_id=person, members=[dict(task_id=m['task_id'], face_id=m['face_id']) for m in faces], **extra)


def preview(client, selection):
    result = client.post('/photos/people-corrections/preview', json=selection)
    assert result.status_code == 200, result.text
    return result.json()


def body(selection, plan, operation='change'):
    return dict(**selection, preview_token=plan['preview_token'], operation_id=operation, method='button')


def test_preview_cancel_revoke_split_merge_remove_idempotency_and_history(setup, monkeypatch):
    client, store, _, batch, people, path = confirmed(setup, monkeypatch)
    (single, one), (source, faces) = people
    original = client.get(path+'/original').content
    date = client.get(path+'/date').json()
    before = client.get('/photos/people-albums').json()
    selection = select('split', source, faces[:1], label='家人')
    plan = preview(client, selection)
    assert plan['counts'] == dict(members=1, photos=1, preserve=0)
    assert client.get('/photos/people-albums').json() == before  # preview/cancel is read-only
    client.post(f'/photos/batches/{batch}/people-consent',json=dict(operation_id='stop',expected_version=1,granted=False,clear=True,method='button'))
    monkeypatch.delenv('IFRAME_PHOTOS_PEOPLE_ENABLED')
    request = body(selection, plan)
    response = client.post('/photos/people-corrections', json=request)
    assert response.status_code == 200, response.text
    new = response.json()['person_id']
    assert client.post('/photos/people-corrections', json=request).json() == response.json()
    assert client.post('/photos/people-corrections', json={**request,'label':'不同'}).status_code == 409
    assert client.post('/photos/people-corrections', json={**request,'operation_id':'stale'}).status_code == 409
    merge = select('merge', source, target_id=new)
    merged = client.post('/photos/people-corrections', json=body(merge, preview(client,merge),'merge'))
    assert merged.status_code == 200
    assert source not in [p['person_id'] for p in client.get('/photos/people-albums').json()['people']]
    assert next(p for p in client.get('/photos/people-albums').json()['people'] if p['person_id']==new)['label'] == '家人'
    remove = select('remove', new, faces[:1])
    assert client.post('/photos/people-corrections', json=body(remove,preview(client,remove),'remove')).status_code == 200
    history = client.get('/photos/people-corrections/history?limit=1').json()
    assert history['next_after'] and len(history['changes']) == 1
    all_history = client.get('/photos/people-corrections/history').json()['changes']
    assert [h['action'] for h in all_history] == ['split','merge','remove']
    assert 'feature' not in json.dumps(all_history)
    assert client.get(path+'/original').content == original
    assert client.get(path+'/date').json() == date
    assert store.people_groups('owner', faces[0]['task_id'])['groups'][0]['status'] in ('confirmed','corrected')


def test_batch_undo_preserves_manual_and_other_batch_relationships(setup, monkeypatch):
    client, store, _, batch, people, _ = confirmed(setup, monkeypatch)
    (single,one),(source,faces) = people
    # Move the singleton's task provenance to a distinct real batch scope.
    other = store.upload('owner','other-upload',__import__('src.apps.photos.media',fromlist=['prepare_photo']).prepare_photo(client.get('/photos/second/original').content))['batch_id']
    with store._connection(write=True) as connection:
        # New task copies only the singleton membership's source, not the two-face source.
        taskrow = dict(connection.execute('SELECT * FROM photo_people_tasks WHERE owner=? AND task_id=?',('owner',one[0]['task_id'])).fetchone())
        taskrow.update(task_id='other-task', batch_id=other, operation_id='other-task')
        columns = ','.join(taskrow)
        connection.execute(f"INSERT INTO photo_people_tasks ({columns}) VALUES ({','.join('?' for _ in taskrow)})",tuple(taskrow.values()))
        connection.execute('UPDATE photo_people_members SET task_id=? WHERE owner=? AND person_id=?',('other-task','owner',single))
    split = select('split',source,faces[:1])
    result=client.post('/photos/people-corrections',json=body(split,preview(client,split)))
    assert result.status_code==200
    undo = select('undo_batch',batch_id=batch)
    plan=preview(client,undo)
    assert plan['counts']==dict(members=1,photos=1,preserve=1)
    response=client.post('/photos/people-corrections',json=body(undo,plan,'undo'))
    assert response.status_code==200
    counts={p['person_id']:p['photo_count'] for p in client.get('/photos/people-albums').json()['people']}
    assert counts=={single:1,result.json()['person_id']:1}
    assert preview(client,undo)['counts']==dict(members=0,photos=0,preserve=1)
    assert client.post('/photos/people-corrections',json=body(undo,plan,'undo')).json()==response.json()


def test_stale_preview_owner_isolation_and_atomic_failure(setup,monkeypatch):
    client,store,app,batch,people,_=confirmed(setup,monkeypatch)
    source,faces=people[1]
    selection=select('remove',source,faces[:1])
    plan=preview(client,selection)
    request=body(selection,plan)
    before=client.get('/photos/people-albums').json()
    with store._connection(write=True) as connection:
        connection.execute("CREATE TRIGGER fail_correction BEFORE INSERT ON photo_people_correction_events BEGIN SELECT RAISE(ABORT,'injected'); END")
    assert client.post('/photos/people-corrections',json=request).status_code==503
    assert client.get('/photos/people-albums').json()==before
    with store._connection(write=True) as connection:
        assert connection.execute('SELECT COUNT(*) FROM photo_people_manual_members').fetchone()[0]==0
        connection.execute('DROP TRIGGER fail_correction')
    def execute(index):
        from src.apps.photos.date_store import OperationConflict
        try:
            store.correct_people('owner','actor',operation_id=f'concurrent-{index}',preview_token=plan['preview_token'],**selection)
            return 'ok'
        except OperationConflict:
            return 'conflict'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(execute,range(2)))==['conflict','ok']
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert client.post('/photos/people-corrections/preview',json=selection).status_code==404
    assert client.post('/photos/people-corrections',json=request).status_code==404
    assert client.get('/photos/people-corrections/history').json()['changes']==[]
    assert client.post('/photos/people-corrections/preview',json=select('undo_batch',batch_id=batch)).status_code==404


def test_invalid_selection_and_button_only(setup,monkeypatch):
    client,_,_,batch,people,_=confirmed(setup,monkeypatch)
    source,faces=people[1]
    for selection in (select('split',source,faces),select('remove',source,[]),select('remove',source,faces[:1]*2),select('merge',source,target_id=source),select('remove',source,faces[:1],batch_id=batch)):
        assert client.post('/photos/people-corrections/preview',json=selection).status_code==422
    selection=select('remove',source,faces[:1])
    request=body(selection,preview(client,selection))
    assert client.post('/photos/people-corrections',json={**request,'method':'voice_confirmed'}).status_code==422
    assert client.post('/photos/people-corrections',json={**request,'owner':'other'}).status_code==422
