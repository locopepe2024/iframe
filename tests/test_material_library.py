import io
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import HTTPException
from PIL import Image
from src.apps.playground.storage import PlaygroundStorage
from src.apps.playground.material_library import MaterialLibrary
from src.apps.playground.image_editor import ImageEditStore


def make_storage(tmp_path, owner='a'):
    return PlaygroundStorage(owner_user_id=owner, owner_profile_id=owner, output_root=str(tmp_path))


def image(storage, name='original.png', color='red'):
    path = Path(storage.output_dir) / 'uploads' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (32, 32), color).save(path)
    return '/playground/input-media/' + name


def test_promotion_is_immutable_idempotent_and_owner_scoped(tmp_path):
    storage = make_storage(tmp_path)
    ref = image(storage)
    library = MaterialLibrary(storage)
    before = Path(storage.resolve_media_reference(ref)).read_bytes()
    with ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(lambda _: library.promote(ref, 'Saved original'), range(3)))
    assert len({row['id'] for row in records}) == 1
    assert len(library.list()) == 1
    record = records[0]
    source = Path(storage.resolve_media_reference(ref))
    source.unlink()
    assert library.content(record['id']).read_bytes() == before
    assert 'filename' not in record and record['retention_state'] == 'permanent'
    with pytest.raises(HTTPException) as error:
        MaterialLibrary(make_storage(tmp_path, 'other')).content(record['id'])
    assert error.value.status_code == 404


def test_saved_image_edits_append_exact_version_without_changing_parent(tmp_path):
    storage = make_storage(tmp_path)
    library = MaterialLibrary(storage)
    first = library.promote(image(storage), 'Original')
    store = ImageEditStore(storage)
    source = store.source(first['content_url'])
    data = io.BytesIO()
    Image.new('RGB', (32, 32), 'blue').save(data, format='PNG')
    copy = store.save(first['content_url'], source['sha256'], data.getvalue(), 'edited.png', 'operation-001')
    second = library.promote(copy['path'], copy['title'], parent_reference=first['content_url'])
    assert second['asset_id'] == first['asset_id']
    assert second['parent_version_id'] == first['id']
    assert second['sha256'] != first['sha256']
    assert store.source(first['content_url'])['sha256'] == first['sha256']
    assert library.parent_for_edit(copy['path'])['id'] == second['id']


def test_promotion_failure_rolls_back_without_partial_collection(tmp_path, monkeypatch):
    storage = make_storage(tmp_path)
    library = MaterialLibrary(storage)
    ref = image(storage)
    monkeypatch.setattr(library, 'public', lambda _: (_ for _ in ()).throw(RuntimeError('failure')))
    with pytest.raises(RuntimeError):
        library.promote(ref)
    assert library.list() == []
    assert list(library.root.glob('*.png')) == []
    assert Path(storage.resolve_media_reference(ref)).is_file()


def test_promotion_rejects_arbitrary_paths_and_foreign_sources(tmp_path):
    storage = make_storage(tmp_path)
    library = MaterialLibrary(storage)
    for ref in ('/etc/passwd', 'https://example.com/a.png', '/playground/input-media/../../a.png'):
        with pytest.raises(HTTPException):
            library.promote(ref)


def test_api_promotes_and_versions_saved_edits_with_owner_isolation(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.playground import api
    from src.apps.identity import UserContext, require_user_context
    storage = make_storage(tmp_path)
    other = make_storage(tmp_path, 'b')
    monkeypatch.setattr(api, '_storage_for', lambda identity: storage if identity.owner_profile_id == 'a' else other)
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    app.dependency_overrides[require_user_context] = lambda: UserContext('a', 'a', '', '')
    client = TestClient(app)
    original = image(storage)
    result = client.post('/playground/material-library', json={'reference': original, 'title': 'Original'})
    assert result.status_code == 201
    saved = result.json()
    source = client.get('/playground/image-editor/source', params={'reference': saved['content_url']}).json()
    edited = io.BytesIO()
    Image.new('RGB', (32, 32), 'green').save(edited, format='PNG')
    payload = {'reference': saved['content_url'], 'source_sha256': source['sha256'], 'operation_key': 'test-version-key'}
    response = client.post('/playground/image-edits', data=payload, files={'file': ('copy.png', edited.getvalue(), 'image/png')})
    assert response.status_code == 201
    assert response.json()['retention_state'] == 'permanent'
    assert response.json()['asset_id'] == saved['asset_id']
    retry = client.post('/playground/image-edits', data=payload, files={'file': ('copy.png', edited.getvalue(), 'image/png')})
    assert retry.json() == response.json()
    assert len(client.get('/playground/material-library').json()) == 2
    assert client.get(saved['content_url']).content != edited.getvalue()
    app.dependency_overrides[require_user_context] = lambda: UserContext('b', 'b', '', '')
    assert client.get(saved['content_url']).status_code == 404
    assert client.get('/playground/material-library').json() == []
