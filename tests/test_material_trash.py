import json
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.playground import api
from src.apps.playground.material_trash import MaterialTrash
from src.apps.playground.storage import PlaygroundStorage


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    monkeypatch.setattr(api, 'media_root', lambda: str(tmp_path))
    monkeypatch.setattr(api, '_storage_for', lambda identity: PlaygroundStorage(
        owner_user_id=identity.user_id, owner_profile_id=identity.owner_profile_id, output_root=str(tmp_path)))
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    app.dependency_overrides[require_user_context] = lambda: UserContext('user-a', 'a', '', '')
    return app, TestClient(app)


def test_empty_reads_do_not_create_storage(tmp_path, fixture):
    _, client = fixture
    assert client.get('/playground/material-trash').json() == []
    assert client.get('/playground/material-library').json() == []
    assert client.get('/playground/media-inventory').json()['items'] == []
    assert list(tmp_path.rglob('*')) == []


def test_delete_restore_is_persistent_idempotent_owner_scoped_and_preserves_files(tmp_path, fixture):
    app, client = fixture
    storage = PlaygroundStorage(owner_user_id='user-a', owner_profile_id='a', output_root=str(tmp_path))
    history = Path(storage.history_path)
    history.parent.mkdir(parents=True)
    history.write_text(json.dumps([dict(id='generation-a', mode='t2i', model_id='model', prompt='p', created_at='2026-11-01T12:00:00Z',
        outputs=[dict(id='out', media_path='original.png', media_type='image')])]))
    source = Path(storage.output_dir) / 'original.png'
    source.parent.mkdir()
    source.write_bytes(b'original-media')
    before = history.read_bytes()
    body = dict(scope='temporary', material_id='generation:generation-a:out')
    response = client.post('/playground/material-trash', json=body)
    assert response.status_code == 201
    trashed = response.json()
    assert client.post('/playground/material-trash', json=body).json() == trashed
    assert client.get('/playground/media-inventory').json()['total'] == 0
    assert MaterialTrash('a', tmp_path).list() == [trashed]
    assert source.read_bytes() == b'original-media' and history.read_bytes() == before
    app.dependency_overrides[require_user_context] = lambda: UserContext('user-b', 'b', '', '')
    assert client.get('/playground/material-trash').json() == []
    assert client.post('/playground/material-trash', json=body).status_code == 404
    client.delete('/playground/material-trash/' + trashed['id'])
    assert MaterialTrash('a', tmp_path).list() == [trashed]
    app.dependency_overrides[require_user_context] = lambda: UserContext('user-a', 'a', '', '')
    assert client.delete('/playground/material-trash/' + trashed['id']).status_code == 200
    assert client.delete('/playground/material-trash/' + trashed['id']).status_code == 200
    assert client.get('/playground/media-inventory').json()['total'] == 1


def test_saved_delete_preserves_exact_content_and_version_lineage(tmp_path, fixture):
    from PIL import Image
    from src.apps.playground.material_library import MaterialLibrary
    _, client = fixture
    storage = PlaygroundStorage(owner_user_id='user-a', owner_profile_id='a', output_root=str(tmp_path))
    path = Path(storage.output_dir) / 'uploads' / 'one.png'
    path.parent.mkdir(parents=True)
    Image.new('RGB', (10, 10), 'red').save(path)
    library = MaterialLibrary(storage)
    first = library.promote('/playground/input-media/one.png')
    Image.new('RGB', (10, 10), 'blue').save(path)
    second = library.promote('/playground/input-media/one.png', parent_reference=first['content_url'])
    content = client.get(first['content_url']).content
    record = client.post('/playground/material-trash', json=dict(scope='saved', material_id=first['id'])).json()
    assert [row['id'] for row in client.get('/playground/material-library').json()] == [second['id']]
    assert client.get(first['content_url']).content == content
    assert library.parent_for_edit(first['content_url'])['id'] == first['id']
    assert library.list()[0]['parent_version_id'] == first['id']
    client.delete('/playground/material-trash/' + record['id'])
    assert len(client.get('/playground/material-library').json()) == 2


def test_corrupt_trash_fails_closed_and_invalid_filters_are_rejected(tmp_path, fixture):
    _, client = fixture
    path = MaterialTrash('a', tmp_path).path
    path.parent.mkdir(parents=True)
    path.write_bytes(b'broken sqlite')
    for url in ['/playground/material-trash', '/playground/media-inventory', '/playground/material-library']:
        assert client.get(url).status_code == 503
    for params in [dict(created_after=20, created_before=10), dict(created_after='nan'), dict(media_type='other'), dict(utc_offset_minutes=900)]:
        assert client.get('/playground/media-inventory', params=params).status_code == 422


@pytest.mark.parametrize('source', ['upload', 'edit'])
def test_uploaded_and_edited_entries_can_be_recycled_without_rewriting_source_stores(tmp_path, fixture, source):
    from src.apps.media_registry import register_media
    import sqlite3
    _, client = fixture
    storage = PlaygroundStorage(owner_user_id='user-a', owner_profile_id='a', output_root=str(tmp_path))
    path = Path(storage.output_dir) / 'uploads' / 'source.png'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'immutable source')
    if source == 'upload':
        register_media('a', path.relative_to(tmp_path).as_posix(), kind='temporary_input', output_root=str(tmp_path))
    else:
        with sqlite3.connect(Path(storage.output_dir) / 'image-edits.sqlite3') as db:
            db.execute('CREATE TABLE edits(data TEXT, created REAL)')
            db.execute('INSERT INTO edits VALUES(?,?)', (json.dumps(dict(id='edit-a', path='/playground/input-media/source.png')), 10))
    original = {str(p): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    item = client.get('/playground/media-inventory').json()['items'][0]
    response = client.post('/playground/material-trash', json=dict(scope='temporary', material_id=item['id']))
    assert response.status_code == 201
    assert client.get('/playground/media-inventory').json()['items'] == []
    assert all(Path(p).read_bytes() == value for p, value in original.items())
    client.delete('/playground/material-trash/' + response.json()['id'])
    assert client.get('/playground/media-inventory').json()['items'][0]['id'] == item['id']
