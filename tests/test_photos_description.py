import pytest

from tests.test_photos_analysis import setup, OBSERVATION
from src.apps.identity import UserContext, require_user_context
from src.apps.photos.analysis import PhotoAnalysis, Observation
from datetime import datetime, timezone


def test_description_confirmation_history_idempotency_and_owner(setup):
    client, store, app, path = setup
    pid = path.split('/')[-1]
    store.save_analysis('owner', pid, 'actor', PhotoAnalysis(model='qwen-test', image_sha256='abc', created_at=datetime.now(timezone.utc), observation=Observation(**OBSERVATION)))
    before = client.get(path + '/date').json()
    assert client.get(path + '/description').json() is None
    body = dict(description='桌旁有椅子', expected_revision=0, operation_id='first')
    first = client.post(path + '/description', json=body)
    assert first.status_code == 200
    assert first.json()['revision'] == 1
    assert client.post(path + '/description', json=body).json() == first.json()
    assert client.post(path + '/description', json={**body, 'description':'changed'}).status_code == 409
    assert client.post(path + '/description', json={**body, 'operation_id':'stale'}).status_code == 409
    assert client.post(path + '/description', json={**body, 'operation_id':'second', 'expected_revision':1, 'description':'新的描述'}).status_code == 200
    assert client.get(path + '/description').json()['description'] == '新的描述'
    page = client.get(path + '/description/history?limit=1').json()
    assert page['next_after_revision'] == 1
    assert len(client.get(path + '/description/history?after_revision=1').json()['changes']) == 1
    assert client.get(path + '/date').json() == before
    assert client.get(path + '/analysis').json()['observation'] == OBSERVATION
    app.dependency_overrides[require_user_context] = lambda: UserContext('other','other','','')
    for suffix in ('/description','/description/history'):
        assert client.get(path + suffix).status_code == 404
    assert client.post(path + '/description',json=body).status_code == 404


def test_no_analysis_or_invalid_description_cannot_confirm(setup):
    client, _, _, path = setup
    body = dict(description='描述', expected_revision=0, operation_id='first')
    assert client.post(path + '/description',json=body).status_code == 409
    for changes in ({'description':'   '},{'description':''},{'description':'x'*1601},{'expected_revision':True},{'owner':'other'}):
        assert client.post(path + '/description',json={**body,**changes}).status_code == 422
