from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from unittest.mock import Mock
import hashlib
import json

from PIL import Image
import pytest

from tests.test_photos_analysis import setup
from src.apps.photos.people_review import PhotoPeopleReviewStore
from src.apps.photos.faces import FaceObservation
from src.apps.photos.media import prepare_photo
from src.apps.identity import UserContext,require_user_context


def face(second=False):
    vector=((0.,1.) if second else (1.,0.))+(0.,)*126
    return FaceObservation((.5 if second else .1,.1,.2,.2),.95,vector)


def prepared(setup,monkeypatch):
    client,base,app,path=setup
    monkeypatch.setenv('IFRAME_PHOTOS_PEOPLE_ENABLED','1')
    store=PhotoPeopleReviewStore(base.path,initialize=False)
    batch=client.get('/photos/albums').json()['photos'][0]['batch_id']
    # A second photo under the same batch, two distinct faces in the original.
    raw=BytesIO();Image.new('RGB',(30,30),'blue').save(raw,'PNG')
    media=prepare_photo(raw.getvalue())
    with store._connection(write=True) as connection:
        store._register(connection,'owner',batch,'second',media.evidence)
        connection.execute('INSERT INTO photo_media VALUES (?,?,?,?,?,?,?)',('owner','second','fixture',hashlib.sha256(media.original).hexdigest(),media.media_type,media.original,media.thumbnail))
    q=client.post(f'/photos/batches/{batch}/people-question').json()
    answer=client.post(f'/photos/batches/{batch}/people-consent',json=dict(operation_id='allow',expected_version=0,granted=True,question_id=q['question_id'],method='button'))
    assert answer.status_code==200
    task=client.post(f'/photos/batches/{batch}/people-tasks',json=dict(operation_id='task',consent_version=1)).json()
    while claim:=store.claim_people_item():
        store.finish_people_item(claim,(face(),) if claim.photo_id=='second' else (face(),face(True)))
    return client,store,app,batch,task['task_id'],path


def review_body(group,action='confirm',operation='review',label=''):
    return dict(operation_id=operation,expected_revision=group['revision'],consent_version=1,action=action,label=label)


def test_candidates_read_only_confirm_explicit_multi_person_photo_and_owner(setup,monkeypatch):
    client,store,app,batch,task,path=prepared(setup,monkeypatch)
    endpoint=f'/photos/people-tasks/{task}/groups'
    assert client.get(endpoint).json()==dict(ready=False,groups=[])
    assert client.get('/photos/people-albums').json()['people']==[]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:store.prepare_people_candidates('owner',task),range(2)))
    assert sorted(results)==[False,True]
    groups=client.get(endpoint).json()['groups']
    assert sorted(len(g['members']) for g in groups)==[1,2]
    assert 'feature' not in json.dumps(groups) and 'token' not in json.dumps(groups)
    before=client.get(path+'/date').json()
    for index,group in enumerate(groups):
        body=review_body(group,label='家人' if index else '')
        url=f"/photos/people-groups/{group['group_id']}/review"
        response=client.post(url,json=body)
        assert response.status_code==200
        assert client.post(url,json=body).json()==response.json()
        assert client.post(url,json={**body,'label':'不同称呼'}).status_code==409
        assert client.post(url,json={**body,'operation_id':'stale'}).status_code==409
    people=client.get('/photos/people-albums?limit=1').json()
    assert len(people['people'])==1 and people['next_after_id']
    all_people=client.get('/photos/people-albums').json()['people']
    assert sorted(p['photo_count'] for p in all_people)==[1,2]
    assert sum(any(photo['photo_id']==path.split('/')[-1] for photo in client.get('/photos/people-albums/'+p['person_id']).json()['photos']) for p in all_people)==2
    assert client.get(path+'/date').json()==before
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert client.get(endpoint).status_code==404
    assert client.get('/photos/people-albums').json()['people']==[]
    assert client.get('/photos/people-albums/'+all_people[0]['person_id']).status_code==404
    assert client.post(url,json=body).status_code==404
    assert client.get(f'/photos/batches/{batch}/people-tasks').status_code==404


def test_split_and_defer_never_create_person_and_clear_preserves_confirmation(setup,monkeypatch):
    client,store,_,batch,task,_=prepared(setup,monkeypatch)
    store.prepare_people_candidates('owner',task)
    endpoint=f'/photos/people-tasks/{task}/groups'
    group=next(g for g in client.get(endpoint).json()['groups'] if len(g['members'])==2)
    url=f"/photos/people-groups/{group['group_id']}/review"
    body=review_body(group,'split')
    assert client.post(url,json=body).status_code==200
    assert client.post(url,json=body).status_code==200
    groups=client.get(endpoint).json()['groups']
    assert len(groups)==4 and len([g for g in groups if g['status']=='pending'])==3
    single=next(g for g in groups if g['status']=='pending')
    single_url=f"/photos/people-groups/{single['group_id']}/review"
    assert client.post(single_url,json=review_body(single,'defer')).status_code==200
    assert client.get('/photos/people-albums').json()['people']==[]
    single={**single,'revision':2}
    assert client.post(single_url,json=review_body(single,operation='confirm-later')).status_code==200
    person=client.get('/photos/people-albums').json()['people'][0]
    consent_url=f'/photos/batches/{batch}/people-consent'
    assert client.post(consent_url,json=dict(operation_id='stop',expected_version=1,granted=False,clear=True,method='button')).status_code==200
    assert client.get('/photos/people-albums').json()['people']==[person]
    assert len(client.get(endpoint).json()['groups'])==1
    with store._connection() as connection:
        assert connection.execute('SELECT COUNT(*) FROM photo_people_faces').fetchone()[0]==0
        assert 'feature' not in connection.execute('SELECT members FROM photo_people_groups').fetchone()[0]
    assert client.post(single_url,json=review_body(single,operation='revoked')).status_code==403


def test_revocation_during_grouping_discards_suggestions(setup,monkeypatch):
    _,store,_,batch,task,_=prepared(setup,monkeypatch)
    def revoke_then_group(faces):
        store.change_people_consent('owner',batch,'actor',operation_id='stop',expected_version=1,granted=False,clear=True)
        return [(f.face_id,) for f in faces]
    monkeypatch.setattr('src.apps.photos.people_review.candidate_groups',revoke_then_group)
    from src.apps.photos.people_tasks import PeopleConsentRequired
    with pytest.raises(PeopleConsentRequired): store.prepare_people_candidates('owner',task)
    assert store.people_groups('owner',task)==dict(ready=False,groups=[])
    assert not store.prepare_next_people_candidates()


def test_disabled_switch_blocks_analysis_but_allows_stop_and_read(setup,monkeypatch):
    client,store,_,batch,task,_=prepared(setup,monkeypatch)
    monkeypatch.delenv('IFRAME_PHOTOS_PEOPLE_ENABLED')
    assert client.get(f'/photos/batches/{batch}/people').json()['enabled'] is False
    assert client.post(f'/photos/batches/{batch}/people-question').status_code==503
    assert client.post(f'/photos/batches/{batch}/people-tasks',json=dict(operation_id='new',consent_version=1)).status_code==503
    assert client.get(f'/photos/batches/{batch}/people-tasks').json()[0]['task_id']==task
    assert client.post(f'/photos/batches/{batch}/people-consent',json=dict(operation_id='stop',expected_version=1,granted=False,method='button')).status_code==200
    assert client.get('/photos/people-albums').status_code==200
    assert client.post(f'/photos/batches/{batch}/people-consent',json=dict(operation_id='voice',expected_version=2,granted=True,method='voice_confirmed')).status_code==422
    assert client.post(f'/photos/batches/{batch}/people-tasks',json=dict(operation_id='spoof',consent_version=1,owner='other')).status_code==422


def test_confirmation_transaction_rolls_back_person_on_member_failure(setup,monkeypatch):
    client,store,_,_,task,_=prepared(setup,monkeypatch)
    store.prepare_people_candidates('owner',task)
    group=store.people_groups('owner',task)['groups'][0]
    with store._connection(write=True) as connection:
        connection.execute("CREATE TRIGGER fail_person_member BEFORE INSERT ON photo_people_members BEGIN SELECT RAISE(ABORT,'injected'); END")
    response=client.post(f"/photos/people-groups/{group['group_id']}/review",json=review_body(group))
    assert response.status_code==503
    assert store.people_albums('owner')['people']==[]
    assert store.people_groups('owner',task)['groups'][0]['revision']==1
