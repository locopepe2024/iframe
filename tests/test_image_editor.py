from io import BytesIO
import json
from types import SimpleNamespace
from pathlib import Path
import pytest
from PIL import Image
from fastapi import HTTPException
from src.apps.playground.storage import PlaygroundStorage
from src.apps.playground.image_editor import ImageEditStore


def png(color='red'):
    out = BytesIO(); Image.new('RGB', (32, 24), color).save(out, format='PNG'); return out.getvalue()


def panorama_png():
    out = BytesIO(); Image.new('RGB', (64, 32), 'teal').save(out, format='PNG'); return out.getvalue()


def panorama_with_pole_gap():
    image = Image.new('RGBA', (64, 32), 'teal')
    for y in range(2):
        for x in range(64):
            image.putpixel((x, y), (0, 0, 0, 0))
    out = BytesIO(); image.save(out, format='PNG'); return out.getvalue()


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


def test_panorama_projection_requires_explicit_declaration_and_exact_ratio(editor):
    store, _ = editor
    source = store.source('/playground/input-media/source.png')
    flat = store.save(source['reference'], source['sha256'], panorama_png(), 'flat.png', 'flat-key-1')
    assert flat['projection_type'] == 'perspective_plane'
    with pytest.raises(HTTPException) as exc:
        store.save(source['reference'], source['sha256'], png(), 'bad.png', 'panorama-key-1', 'equirectangular')
    assert exc.value.status_code == 422
    panorama = store.save(source['reference'], source['sha256'], panorama_png(), 'pano.png', 'panorama-key-2', 'equirectangular')
    assert panorama['projection_type'] == 'equirectangular'
    assert panorama['panorama_quality']['status'] == 'pass'
    assert ImageEditStore(store.storage).list()[0] == panorama
    with pytest.raises(HTTPException) as exc:
        store.save(source['reference'], source['sha256'], panorama_png(), 'pano.png', 'panorama-key-2', 'perspective_plane')
        assert exc.value.status_code == 409


def test_panorama_projection_rejects_pole_gaps(editor):
    store, _ = editor
    source = store.source('/playground/input-media/source.png')
    with pytest.raises(HTTPException) as exc:
        store.save(source['reference'], source['sha256'], panorama_with_pole_gap(), 'bad-pano.png', 'panorama-gap-key', 'equirectangular')
    assert exc.value.status_code == 422
    assert 'gap' in str(exc.value.detail)


def test_pre_projection_save_key_still_replays_a_standard_edit(editor):
    store, _ = editor
    source = store.source('/playground/input-media/source.png')
    saved = store.save(source['reference'], source['sha256'], png('blue'), 'old.png', 'legacy-key-1')
    old_intent = json.dumps([source['reference'], source['sha256'], saved['sha256'], 'old.png'])
    with store.db() as db:
        db.execute('UPDATE edits SET intent=? WHERE operation_key=?', (old_intent, 'legacy-key-1'))
    assert store.save(source['reference'], source['sha256'], png('blue'), 'old.png', 'legacy-key-1') == saved
    with pytest.raises(HTTPException) as exc:
        store.save(source['reference'], source['sha256'], png('blue'), 'old.png', 'legacy-key-1', 'equirectangular')
    assert exc.value.status_code == 422


def test_library_import_uses_owner_index_and_variant_id(editor):
    store, path = editor
    variant = SimpleNamespace(id='variant-1', url=str(path))
    entry = SimpleNamespace(source_scope='project', source_container_id='project-1',
                            asset_type='scene', asset_id='scene-1', name='Room', variants=[variant])
    index = SimpleNamespace(assets=[entry])
    def resolve(value, owner):
        assert owner == store.storage.owner_profile_id
        assert value == str(path)
        return value
    imported = store.import_library_variant(index, 'project', 'project-1', 'scene', 'scene-1', 'variant-1', resolve)
    assert imported['path'].startswith('/playground/input-media/library-')
    assert store.source(imported['path'])['sha256'] == imported['sha256']
    assert path.read_bytes() == png()
    for scope, variant_id in [('series', 'variant-1'), ('project', 'other')]:
        with pytest.raises(HTTPException) as exc:
            store.import_library_variant(index, scope, 'project-1', 'scene', 'scene-1', variant_id, resolve)
        assert exc.value.status_code == 404


def test_library_import_route_rejects_other_owner_asset(editor, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.playground import api as playground_api
    from src.apps.comic_gen import api as studio_api
    from src.apps.identity import require_user_context, UserContext
    store, path = editor
    entry = SimpleNamespace(source_scope='project', source_container_id='project-1',
                            asset_type='scene', asset_id='scene-1', name='Room',
                            variants=[SimpleNamespace(id='variant-1', url=str(path))])
    monkeypatch.setattr(studio_api.pipeline, 'get_asset_library_reference_index',
                        lambda owner: SimpleNamespace(assets=[entry] if owner == 'a' else []))
    monkeypatch.setattr(studio_api.pipeline, '_resolve_stored_reference_value', lambda value, owner: value)
    monkeypatch.setattr(playground_api, '_storage_for', lambda identity: store.storage)
    app = FastAPI(); app.include_router(playground_api.router, prefix='/playground')
    client = TestClient(app)
    request = {'source_scope': 'project', 'source_container_id': 'project-1',
               'asset_type': 'scene', 'asset_id': 'scene-1', 'variant_id': 'variant-1'}
    app.dependency_overrides[require_user_context] = lambda: UserContext('b', 'b', '', '')
    assert client.post('/playground/image-editor/library-import', data=request).status_code == 404
    app.dependency_overrides[require_user_context] = lambda: UserContext('a', 'a', '', '')
    response = client.post('/playground/image-editor/library-import', data=request)
    assert response.status_code == 200
    assert response.json()['path'].startswith('/playground/input-media/library-')
