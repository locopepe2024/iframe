from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from io import BytesIO
import json
from threading import Event
from unittest.mock import Mock

from PIL import Image
import pytest

from tests.test_photos_analysis import setup
from src.apps.photos.people_tasks import (
    PhotoPeopleStore, PeopleConsentRequired, LEASE_SECONDS, MAX_ATTEMPTS,
)
from src.apps.photos.date_store import OperationConflict, PhotoNotAvailable
from src.apps.photos.faces import FaceObservation
from src.apps.photos.media import prepare_photo


@pytest.fixture
def people(setup):
    client, base, _, path = setup
    now = [1000.]
    store = PhotoPeopleStore(base.path,initialize=False,clock=lambda:now[0])
    batch = client.get('/photos/albums').json()['photos'][0]['batch_id']
    return client, store, batch, path, now


def grant(store,batch,operation='allow'):
    q = store.people_question('owner',batch)
    return store.change_people_consent('owner',batch,'actor',operation_id=operation,
        expected_version=q['consent_version'],granted=True,question_id=q['question_id'])


def create(store,batch,version=1,operation='task',retry=None):
    return store.create_people_task('owner',batch,'actor',operation_id=operation,consent_version=version,retry_task_id=retry)


def face():
    return FaceObservation((.1,.1,.2,.2),.95,(1.,)+(0.,)*127)


def derived(store):
    with store._connection() as connection:
        return connection.execute('SELECT count(*) FROM photo_people_faces').fetchone()[0]


def test_upload_and_time_consent_do_not_grant_people_permission(people):
    client,store,batch,path,_ = people
    assert store.people_consent('owner',batch)==dict(granted=False,consent_version=0)
    assert store.claim_people_item() is None
    q=client.post(f'/photos/batches/{batch}/time-question').json()
    assert client.post(f'/photos/batches/{batch}/time-consent',json=dict(question_id=q['question_id'],granted=True,method='button')).status_code==200
    with pytest.raises(PeopleConsentRequired): create(store,batch)
    assert derived(store)==0
    assert store.people_consent('owner',batch)['granted'] is False
    assert client.get(path+'/date').json()['revision']==1


def test_questions_expire_replace_and_operations_are_idempotent(people):
    _,store,batch,_,now=people
    old=store.people_question('owner',batch)
    q=store.people_question('owner',batch)
    with pytest.raises(OperationConflict):
        store.change_people_consent('owner',batch,'actor',operation_id='old',expected_version=0,granted=True,question_id=old['question_id'])
    now[0]+=901
    with pytest.raises(OperationConflict):
        store.change_people_consent('owner',batch,'actor',operation_id='expired',expected_version=0,granted=True,question_id=q['question_id'])
    result=grant(store,batch)
    with store._connection() as connection:
        question=connection.execute('SELECT question_id FROM photo_people_questions').fetchone()[0]
    assert store.change_people_consent('owner',batch,'actor',operation_id='allow',expected_version=0,granted=True,question_id=question)==result
    with pytest.raises(OperationConflict):
        store.change_people_consent('owner',batch,'other',operation_id='allow',expected_version=0,granted=True,question_id=question)
    with pytest.raises(PhotoNotAvailable): store.people_question('other',batch)


def test_task_snapshot_owner_idempotency_and_read_only_results(people):
    client,store,batch,path,_=people
    grant(store,batch)
    task=create(store,batch)
    assert create(store,batch)==task
    with pytest.raises(OperationConflict): create(store,batch,operation='other')
    for _ in range(2): assert store.people_task('owner',task['task_id'])==task
    assert task['counts']['pending']==1 and derived(store)==0
    assert not any(secret in json.dumps(task) for secret in ['thumbnail','token','feature','observation'])
    with pytest.raises(PhotoNotAvailable): store.people_task('other',task['task_id'])
    assert client.get(path+'/date').json()['revision']==1


def test_claim_concurrency_only_one_lease(people):
    _,store,batch,_,_=people
    grant(store,batch);create(store,batch)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims=list(pool.map(lambda _:PhotoPeopleStore(store.path,initialize=False,clock=store.clock).claim_people_item(),range(2)))
    assert sum(claim is not None for claim in claims)==1
    claim=next(c for c in claims if c)
    assert 'thumbnail' not in repr(claim) and claim.token not in repr(claim)
    store.finish_people_item(claim,(face(),))
    with pytest.raises(OperationConflict): store.finish_people_item(claim,(face(),))
    assert derived(store)==1
    assert store.people_task('owner',claim.task_id)['status']=='needs_review'


def test_expired_token_cannot_commit_or_renew_and_new_process_reclaims(people):
    _,store,batch,_,now=people
    grant(store,batch);task=create(store,batch)
    first=store.claim_people_item()
    now[0]+=LEASE_SECONDS+1
    for action in [lambda:store.renew_people_claim(first),lambda:store.finish_people_item(first,(face(),))]:
        with pytest.raises(OperationConflict): action()
    resumed=PhotoPeopleStore(store.path,initialize=False,clock=store.clock)
    second=resumed.claim_people_item()
    assert second.token!=first.token
    with pytest.raises(OperationConflict): store.finish_people_item(first,(face(),))
    resumed.finish_people_item(second,())
    result=store.people_task('owner',task['task_id'])
    assert result['status']=='completed' and result['counts']['no_faces']==1
    assert result['items'][0]['attempts']==2 and derived(store)==0


def test_valid_renewal_extends_lease_but_exhaustion_is_bounded(people):
    _,store,batch,_,now=people
    grant(store,batch);task=create(store,batch)
    claim=store.claim_people_item(); now[0]+=60
    store.renew_people_claim(claim)
    now[0]+=61
    store.check_people_claim(claim)
    for _ in range(MAX_ATTEMPTS-1):
        now[0]+=LEASE_SECONDS+1
        claim=store.claim_people_item()
        assert claim
    now[0]+=LEASE_SECONDS+1
    assert store.claim_people_item() is None
    result=store.people_task('owner',task['task_id'])
    assert result['status']=='failed' and result['items'][0]['error_code']=='lease_exhausted'


def test_revoke_inference_race_does_not_hold_db_lock_or_commit(people):
    client,store,batch,path,_=people
    original=client.get(path+'/original').content
    date=client.get(path+'/date').json()
    grant(store,batch);task=create(store,batch)
    entered,release=Event(),Event()
    def inference(_):
        entered.set()
        assert release.wait(5)
        return (face(),)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(store.process_people_item,Mock(analyze_thumbnail=inference))
        assert entered.wait(5)
        try:
            receipt=store.change_people_consent('owner',batch,'actor',operation_id='revoke',expected_version=1,granted=False,clear=True)
            assert receipt['cleared']
            assert store.people_task('owner',task['task_id'])['status']=='cancelled'
        finally:
            release.set()
        assert pending.result(5)
    assert derived(store)==0
    assert client.get(path+'/original').content==original
    assert client.get(path+'/date').json()==date
    grant(store,batch,'allow-again')
    assert not store.process_people_item(Mock())
    assert store.people_task('owner',task['task_id'])['counts']['cancelled']==1


def test_reauthorization_never_revives_old_claim(people):
    _,store,batch,_,_=people
    grant(store,batch);create(store,batch)
    claim=store.claim_people_item()
    store.change_people_consent('owner',batch,'actor',operation_id='stop',expected_version=1,granted=False)
    grant(store,batch,'again')
    with pytest.raises(PeopleConsentRequired): store.finish_people_item(claim,(face(),))
    fresh=create(store,batch,version=3,operation='fresh')
    assert fresh['counts']['pending']==1


def test_partial_failures_retry_only_failed_and_never_expose_vectors(people):
    _,store,batch,_,_=people
    output=BytesIO();Image.new('RGB',(30,30),'blue').save(output,'PNG')
    # Existing upload primitive allocates its own batch. Register second raw media
    # here as fixture data to exercise a two-photo same-batch task.
    from src.apps.photos.dates import PhotoTimeEvidence
    prepared=prepare_photo(output.getvalue())
    with store._connection(write=True) as connection:
        store._register(connection,'owner',batch,'second',PhotoTimeEvidence())
        import hashlib
        connection.execute('INSERT INTO photo_media VALUES (?,?,?,?,?,?,?)',('owner','second','fixture',hashlib.sha256(prepared.original).hexdigest(),prepared.media_type,prepared.original,prepared.thumbnail))
    grant(store,batch);task=create(store,batch)
    claim=store.claim_people_item(); store.finish_people_item(claim,(face(),))
    failed=store.claim_people_item(); store.finish_people_item(failed,error_code='inference_failed')
    assert store.people_task('owner',task['task_id'])['status']=='partial_failed'
    retry=create(store,batch,operation='retry',retry=task['task_id'])
    assert [i['photo_id'] for i in retry['items']]==[failed.photo_id]
    store.process_people_item(Mock(analyze_thumbnail=Mock(return_value=())))
    assert store.people_task('owner',retry['task_id'])['counts']['no_faces']==1
    assert derived(store)==1


def test_clear_scope_preserves_other_batch_and_receipt_is_idempotent(people):
    client,store,batch,_,_=people
    output=BytesIO();Image.new('RGB',(25,25),'green').save(output,'PNG')
    other_id=client.post('/photos/uploads/other',content=output.getvalue()).json()['photo_id']
    other=next(p['batch_id'] for p in client.get('/photos/albums').json()['photos'] if p['photo_id']==other_id)
    for current in [batch,other]:
        grant(store,current);create(store,current)
        store.finish_people_item(store.claim_people_item(),(face(),))
    assert derived(store)==2
    args=dict(operation_id='clear',expected_version=1,granted=False,clear=True)
    receipt=store.change_people_consent('owner',batch,'actor',**args)
    assert store.change_people_consent('owner',batch,'actor',**args)==receipt
    assert derived(store)==1
    with store._connection() as connection:
        assert connection.execute('SELECT photo_id FROM photo_people_faces').fetchone()[0]==other_id
        assert 'feature' not in connection.execute('SELECT request FROM photo_people_consent_events LIMIT 1').fetchone()[0]
    with pytest.raises(PhotoNotAvailable): store.change_people_consent('other',other,'other',**args)


def test_source_or_fingerprint_change_and_transaction_failure_reject_commit(people):
    _,store,batch,_,_=people
    grant(store,batch);task=create(store,batch)
    claim=store.claim_people_item()
    with pytest.raises(OperationConflict): store.finish_people_item(replace(claim,fingerprint='changed'),(face(),))
    with store._connection(write=True) as connection:
        connection.execute("CREATE TRIGGER fail_second_face BEFORE INSERT ON photo_people_faces WHEN NEW.face_id LIKE '%-1' BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError): store.finish_people_item(claim,(face(),face()))
    assert derived(store)==0
    assert store.people_task('owner',task['task_id'])['counts']['running']==1
    with store._connection(write=True) as connection:
        connection.execute('UPDATE photo_media SET thumbnail=? WHERE owner=? AND photo_id=?',(b'changed','owner',claim.photo_id))
    with pytest.raises(OperationConflict): store.finish_people_item(claim,(face(),))
    assert derived(store)==0


def test_engine_failures_are_safe_errors_and_no_faces_is_not_failure(people):
    _,store,batch,_,_=people
    grant(store,batch);task=create(store,batch)
    assert store.process_people_item(Mock(analyze_thumbnail=Mock(side_effect=ValueError('private payload'))))
    result=store.people_task('owner',task['task_id'])
    assert result['status']=='failed' and result['items'][0]['error_code']=='invalid_model_output'
    assert 'private' not in json.dumps(result)
    retry=create(store,batch,operation='retry',retry=task['task_id'])
    assert store.process_people_item(Mock(analyze_thumbnail=Mock(side_effect=RuntimeError('secret'))))
    assert store.people_task('owner',retry['task_id'])['items'][0]['error_code']=='inference_failed'
    assert derived(store)==0


def test_worker_validates_bad_return_instead_of_leaving_running_item(people):
    _,store,batch,_,_=people
    grant(store,batch);task=create(store,batch)
    assert store.process_people_item(Mock(analyze_thumbnail=Mock(return_value=None)))
    assert store.people_task('owner',task['task_id'])['items'][0]['error_code']=='invalid_model_output'


def test_wrong_model_pending_task_fails_without_inference(people):
    _,store,batch,_,_=people
    grant(store,batch);task=create(store,batch)
    with store._connection(write=True) as connection:
        connection.execute('UPDATE photo_people_tasks SET fingerprint=?',('different-model',))
    model=Mock()
    assert not store.process_people_item(model)
    model.analyze_thumbnail.assert_not_called()
    assert store.people_task('owner',task['task_id'])['items'][0]['error_code']=='model_changed'


def test_clear_failure_rolls_back_authorization_and_derived_rows(people):
    _,store,batch,_,_=people
    grant(store,batch);task=create(store,batch)
    store.finish_people_item(store.claim_people_item(),(face(),))
    with store._connection(write=True) as connection:
        connection.execute("CREATE TRIGGER prevent_clear BEFORE DELETE ON photo_people_faces BEGIN SELECT RAISE(ABORT,'injected'); END")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        store.change_people_consent('owner',batch,'actor',operation_id='clear',expected_version=1,granted=False,clear=True)
    assert derived(store)==1
    assert store.people_consent('owner',batch)==dict(granted=True,consent_version=1)
    assert store.people_task('owner',task['task_id'])['status']=='needs_review'
