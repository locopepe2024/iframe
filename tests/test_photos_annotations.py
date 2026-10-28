from tests.test_photos_analysis import setup


def test_structured_facts_versions_owner_and_recoverable_delete(setup):
    client, store, _, path = setup
    initial = client.get(path + '/annotations').json()
    assert initial['revision'] == 0
    facts = {**initial['facts'], 'people': [dict(reference='左侧人物', name='小明', age=68, gender='male')],
             'scene': '在院子里', 'lighting': '傍晚暖光', 'location': '杭州', 'capture_time': '2026-10-28'}
    body = dict(operation_id='facts', expected_revision=0, facts=facts)
    response = client.post(path + '/annotations', json=body)
    assert response.status_code == 200, response.text
    assert response.json()['revision'] == 1
    assert client.get(path + '/annotations').json() == response.json()
    assert client.post(path + '/annotations', json=body).json() == response.json()
    assert client.post(path + '/annotations', json={**body, 'operation_id': 'stale'}).status_code == 409
    assert client.post(path + '/annotations', json={**body, 'facts': {**facts,'capture_time':'2025-02-30'}}).status_code == 422
    assert client.post('/photos/absent/annotations', json=body).status_code == 404
    assert client.post(path + '/delete', json=dict(operation_id='delete', confirmed=False)).status_code == 422
    deletion = client.post(path + '/delete', json=dict(operation_id='delete',confirmed=True))
    assert deletion.status_code == 200, deletion.text
    assert client.post(path + '/delete', json=dict(operation_id='delete',confirmed=True)).json() == deletion.json()
    assert client.get('/photos/albums').json()['photos'] == []
    assert client.get(path + '/annotations').status_code == 404
    assert client.get(path + '/thumbnail').status_code == 404
    # Recoverable deletion preserves original bytes and audit facts in storage.
    import sqlite3
    with sqlite3.connect(store.path) as db:
        assert db.execute('SELECT count(*) FROM photo_media').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM photo_annotation_events').fetchone()[0] == 1
