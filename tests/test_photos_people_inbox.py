"""Pending inbox is a scoped read view, not another analysis entry point."""
from tests.test_photos_analysis import setup
from tests.test_photos_people_review import prepared, review_body
from src.apps.identity import UserContext, require_user_context


def test_read_only_deferred_confirmed_and_revoked_filter(setup,monkeypatch):
    client,store,app,batch,task,_=prepared(setup,monkeypatch)
    url='/photos/people-reviews'
    assert client.get(url).json()==dict(reviews=[],next_after_id=None)
    store.prepare_people_candidates('owner',task)
    with store._connection() as connection:
        before=connection.execute('SELECT COUNT(*) FROM photo_people_review_events').fetchone()[0]
        persons=connection.execute('SELECT COUNT(*) FROM photo_people_persons').fetchone()[0]
    for _ in range(2):
        page=client.get(url).json()
        assert page['reviews']==[dict(task_id=task,batch_id=batch,consent_version=1,pending_groups=2,deferred_groups=0,photo_count=2)]
        assert 'feature' not in str(page)
    with store._connection() as connection:
        assert connection.execute('SELECT COUNT(*) FROM photo_people_review_events').fetchone()[0]==before
        assert connection.execute('SELECT COUNT(*) FROM photo_people_persons').fetchone()[0]==persons
    groups=store.people_groups('owner',task)['groups']
    for group,action in zip(groups,['confirm','defer']):
        assert client.post(f"/photos/people-groups/{group['group_id']}/review",json=review_body(group,action)).status_code==200
    assert client.get(url).json()['reviews'][0]['pending_groups']==0
    assert client.get(url).json()['reviews'][0]['deferred_groups']==1
    monkeypatch.delenv('IFRAME_PHOTOS_PEOPLE_ENABLED')
    assert client.get(url).json()['reviews']  # read independent of deployment flag
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert client.get(url).json()==dict(reviews=[],next_after_id=None)
    app.dependency_overrides[require_user_context]=lambda:UserContext('owner','user','','')
    store.change_people_consent('owner',batch,'actor',operation_id='stop',expected_version=1,granted=False)
    assert client.get(url).json()['reviews']==[]
    q=store.people_question('owner',batch)
    store.change_people_consent('owner',batch,'actor',operation_id='allow-again',expected_version=2,granted=True,question_id=q['question_id'])
    assert client.get(url).json()['reviews']==[]  # reauthorization never revives old review


def test_cross_batch_pagination_and_confirmed_task_disappears(setup,monkeypatch):
    client,store,_,batch,task,_=prepared(setup,monkeypatch)
    store.prepare_people_candidates('owner',task)
    from src.apps.photos.media import prepare_photo
    raw=client.get('/photos/second/original').content
    other=store.upload('owner','inbox-other',prepare_photo(raw))['batch_id']
    with store._connection(write=True) as connection:
        source=dict(connection.execute('SELECT * FROM photo_people_tasks WHERE owner=? AND task_id=?',('owner',task)).fetchone())
        connection.execute('INSERT INTO photo_people_consents VALUES (?,?,1,1)',('owner',other))
        source.update(task_id='z-next-task',batch_id=other,operation_id='next')
        connection.execute(f"INSERT INTO photo_people_tasks ({','.join(source)}) VALUES ({','.join('?' for _ in source)})",tuple(source.values()))
        connection.execute("INSERT INTO photo_people_groups VALUES (?,?,?, ?,1,'deferred',NULL)",('owner','z-next-task','next-group','[]'))
    first=client.get('/photos/people-reviews?limit=1').json()
    second=client.get('/photos/people-reviews',params=dict(limit=1,after_id=first['next_after_id'])).json()
    assert [first['reviews'][0]['batch_id'],second['reviews'][0]['batch_id']]==[batch,other]
    assert second['next_after_id'] is None
    for group in store.people_groups('owner',task)['groups']:
        client.post(f"/photos/people-groups/{group['group_id']}/review",json=review_body(group))
    assert [r['task_id'] for r in client.get('/photos/people-reviews').json()['reviews']]==['z-next-task']
    assert client.get('/photos/people-reviews?limit=101').status_code==422
