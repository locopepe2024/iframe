from io import BytesIO
from pathlib import Path
import pytest
from PIL import Image
from fastapi import HTTPException
from src.apps.playground.storage import PlaygroundStorage
from src.apps.playground.image_editor import ImageEditStore


def png(color='red'):
    out = BytesIO(); Image.new('RGB', (32, 24), color).save(out, format='PNG'); return out.getvalue()


@pytest.fixture
def editor(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    storage = PlaygroundStorage(owner_user_id='a', owner_profile_id='a')
    path = Path(storage.output_dir) / 'uploads' / 'source.png'
    path.parent.mkdir(parents=True); path.write_bytes(png())
    return ImageEditStore(storage), path


def test_save_preserves_source_and_replays_after_reload(editor):
    store, path = editor
    ref='/playground/input-media/source.png'
    source = store.source(ref)
    record = store.save(ref, source['sha256'], png('blue'), 'edited.png', 'save-key-1')
    assert path.read_bytes() == png()
    assert record['source_sha256'] == source['sha256']
    assert record['width'] == 32 and record['height'] == 24
    restarted=ImageEditStore(store.storage)
    assert restarted.save(ref, source['sha256'], png('blue'), 'edited.png', 'save-key-1') == record
    assert restarted.list() == [record]
    assert store.storage.resolve_media_reference(record['path']) != str(path)
    with pytest.raises(HTTPException) as exc:
        store.save(ref, source['sha256'], png('green'), 'edited.png', 'save-key-1')
    assert exc.value.status_code == 409


def test_rejects_remote_other_owner_invalid_and_stale_source(editor):
    store,path=editor
    other=ImageEditStore(PlaygroundStorage(owner_user_id='b', owner_profile_id='b'))
    for ref in [str(path), 'https://example.test/image.png', '/playground/input-media/../source.png']:
        with pytest.raises(HTTPException): other.source(ref)
    source=store.source('/playground/input-media/source.png')
    with pytest.raises(HTTPException): store.save(source['reference'], source['sha256'], b'not an image', 'bad.png', 'save-key-2')
    path.write_bytes(png('green'))
    with pytest.raises(HTTPException) as exc:
        store.save(source['reference'], source['sha256'], png('blue'), 'out.png', 'save-key-3')
    assert exc.value.status_code == 409


def test_image_editor_api_requires_owner_and_checks_preview_hash(editor, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.playground import api
    from src.apps.identity import require_user_context, UserContext
    store, _ = editor
    stranger=PlaygroundStorage(owner_user_id='b', owner_profile_id='b')
    monkeypatch.setattr(api, '_storage_for', lambda identity: store.storage if identity.owner_profile_id == 'a' else stranger)
    app=FastAPI(); app.include_router(api.router, prefix='/playground')
    client=TestClient(app)
    assert client.get('/playground/image-edits').json() == []
    assert client.get('/playground/image-editor/source', params={'reference':'/playground/input-media/source.png'}).status_code == 404
    app.dependency_overrides[require_user_context] = lambda: UserContext('a','a','','')
    reference='/playground/input-media/source.png'
    source=client.get('/playground/image-editor/source', params={'reference':reference}).json()
    preview=client.get('/playground/image-editor/preview', params={'reference':reference,'expected_sha256':source['sha256']})
    assert preview.status_code==200 and preview.content==png()
    assert client.get('/playground/image-editor/preview', params={'reference':reference,'expected_sha256':'0'*64}).status_code==409
    data={'reference':reference,'source_sha256':source['sha256'],'operation_key':'api-save-key'}
    response=client.post('/playground/image-edits',data=data,files={'file':('edit.png',png('blue'),'image/png')})
    assert response.status_code==201
    assert client.get('/playground/image-edits').json()==[response.json()]
    assert client.get(response.json()['path']).content==png('blue')


def test_bounds_and_cross_owner_generated_source(editor):
    from src.apps.playground.image_editor import inspect_image, MAX_IMAGE_BYTES
    store, _ = editor
    with pytest.raises(HTTPException) as exc:
        inspect_image(b'x'*(MAX_IMAGE_BYTES+1))
    assert exc.value.status_code==413
    other=ImageEditStore(PlaygroundStorage(owner_user_id='b',owner_profile_id='b'))
    with pytest.raises(HTTPException) as exc:
        other.source('/playground/media/someone-elses-generation/output')
    assert exc.value.status_code==404
