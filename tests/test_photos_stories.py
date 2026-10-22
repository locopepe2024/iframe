import pytest

from tests.test_photos_analysis import setup
from src.apps.identity import UserContext, require_user_context


def test_story_without_analysis_versions_retry_restore_and_isolation(setup):
    client, store, app, path = setup
    before = client.get(path + '/date').json()
    assert client.get(path + '/analysis').json() is None
    assert client.get(path + '/story').json() is None
    body = dict(text='那年和家人一起去公园。', expected_revision=0, operation_id='one')
    first = client.post(path + '/story', json=body)
    assert first.status_code == 200
    assert first.json()['revision'] == 1
    assert first.json()['actor'] == 'actor'
    assert client.post(path + '/story', json=body).json() == first.json()
    for changes in ({'text': 'changed'}, {'operation_id': 'stale'}, {'expected_revision': 1}):
        assert client.post(path + '/story', json={**body, **changes}).status_code == 409
    second = {**body, 'text': '记得是和朋友一起。', 'expected_revision': 1, 'operation_id': 'two'}
    assert client.post(path + '/story', json=second).json()['revision'] == 2
    # Retry of an older successful operation returns that result without a new revision.
    assert client.post(path + '/story', json=body).json() == first.json()
    assert client.post(path + '/story', json={**body, 'expected_revision': 2, 'operation_id': 'restore'}).json()['revision'] == 3
    assert client.get(path + '/story').json()['text'] == body['text']
    page = client.get(path + '/story/history?limit=1').json()
    assert page['next_after_revision'] == 1
    rest = client.get(path + '/story/history?after_revision=1').json()
    assert [row['revision'] for row in rest['changes']] == [2, 3]
    assert rest['next_after_revision'] is None
    assert client.get(path + '/date').json() == before
    assert client.get(path + '/analysis').json() is None
    assert client.get(path + '/description').json() is None
    app.dependency_overrides[require_user_context] = lambda: UserContext('other', 'other', '', '')
    for suffix in ('/story', '/story/history'):
        assert client.get(path + suffix).status_code == 404
    assert client.post(path + '/story', json=body).status_code == 404


@pytest.mark.parametrize('changes', [
    {'text': ''}, {'text': '   '}, {'text': 'x' * 4001}, {'text': 1},
    {'expected_revision': True}, {'expected_revision': -1}, {'owner': 'other'},
    {'operation_id': ''}, {'operation_id': '../bad'},
])
def test_story_invalid_input_does_not_write(setup, changes):
    client, _, _, path = setup
    body = dict(text='我的回忆', expected_revision=0, operation_id='first')
    assert client.post(path + '/story', json={**body, **changes}).status_code == 422
    assert client.get(path + '/story').json() is None
