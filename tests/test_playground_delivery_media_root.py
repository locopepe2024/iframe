import asyncio
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import UploadFile

from src.apps.identity import UserContext
from src.apps.media_registry import get_media
from src.apps.playground import api
from src.apps.playground.models import PlaygroundGeneration, PlaygroundOutput
from src.apps.playground.service import PlaygroundService
from src.apps.playground.storage import PlaygroundStorage
from src.apps.studio_access import studio_media_url, studio_owner_key, verify_studio_media


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    cwd = tmp_path / 'cwd'
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-signing-key')
    root = tmp_path / 'media'
    identity = UserContext(user_id='user-a', owner_profile_id='owner-a', display_name='', access_token='')
    storage = PlaygroundStorage(owner_user_id=identity.user_id, owner_profile_id=identity.owner_profile_id,
                                output_root=str(root))
    monkeypatch.setattr(api, '_storage_for', lambda _: storage)
    return root, identity, storage


def test_upload_registry_and_download_share_root(workspace):
    root, identity, storage = workspace
    uploaded = asyncio.run(api.upload_media(UploadFile(filename='portrait.jpg', file=BytesIO(b'portrait bytes')), identity))
    record = get_media(identity.owner_profile_id, uploaded['media_id'], output_root=str(root))
    assert record is not None
    assert record['storage_key'].startswith(f'users/{studio_owner_key(identity.owner_profile_id)}/playground/uploads/')
    assert (root / record['storage_key']).read_bytes() == b'portrait bytes'
    filename = uploaded['path'].rsplit('/', 1)[1]
    response = api.get_input_media(filename, identity)
    assert Path(response.path).read_bytes() == b'portrait bytes'
    assert not Path('output').exists()


def test_expired_studio_reference_renews_in_selected_root(workspace):
    root, identity, storage = workspace
    key = f'users/{studio_owner_key(identity.owner_profile_id)}/studio/uploads/portrait.jpg'
    path = root / key
    path.parent.mkdir(parents=True)
    path.write_bytes(b'portrait')
    expired = studio_media_url(identity.owner_profile_id, key, ttl_seconds=-3600, output_root=str(root))
    payload = api._public_reference_fields({'input_media': [expired], 'media_names': {expired: 'Portrait'}}, identity)
    renewed = payload['input_media'][0]
    assert renewed != expired
    assert payload['media_names'][renewed] == 'Portrait'
    assert storage.browser_media_reference(key).startswith('/studio/media/')
    q = parse_qs(urlsplit(renewed).query)
    verified = verify_studio_media(studio_owner_key(identity.owner_profile_id), 'uploads/portrait.jpg',
                                  int(q['expires'][0]), q['signature'][0], output_root=str(root))
    assert Path(verified).read_bytes() == b'portrait'


@pytest.mark.parametrize('prefix', ['', 'output/', 'outputs/'])
def test_service_input_and_archive_use_selected_root(workspace, prefix):
    root, identity, storage = workspace
    path = Path(storage.output_dir) / 'images/image.jpg'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'correct image')
    key = path.relative_to(root).as_posix()
    if prefix:
        wrong = Path(prefix + key)
        wrong.parent.mkdir(parents=True, exist_ok=True)
        wrong.write_bytes(b'wrong legacy image')
    generation = PlaygroundGeneration(id='g', mode='i2v', model_id='test', prompt='test', created_at='today',
        owner_user_id=identity.user_id, owner_profile_id=identity.owner_profile_id, input_media=[prefix + key],
        outputs=[PlaygroundOutput(id='o', media_type='image', media_path=prefix + key)])
    storage.add_generation(generation)
    service = PlaygroundService(storage)
    local, remote = service._resolve_first_input_media(generation)
    assert remote is None
    assert Path(local).read_bytes() == b'correct image'
    assert service.save_to_library('g', 'o', 'portraits')
    assert (Path(storage.asset_dir) / 'portraits/image.jpg').read_bytes() == b'correct image'


@pytest.mark.parametrize('category', ['../escape', '/absolute', 'nested/../../escape'])
def test_archive_category_cannot_escape_asset_directory(workspace, category):
    root, identity, storage = workspace
    path = Path(storage.output_dir) / 'images/image.jpg'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'image')
    storage.add_generation(PlaygroundGeneration(id='g', mode='t2i', model_id='test', prompt='test', created_at='today',
        owner_user_id=identity.user_id, owner_profile_id=identity.owner_profile_id,
        outputs=[PlaygroundOutput(id='o', media_type='image', media_path=str(path))]))
    with pytest.raises(ValueError):
        PlaygroundService(storage).save_to_library('g', 'o', category)


def test_upload_symlink_escape_rejected_before_writing(workspace, tmp_path):
    root, identity, storage = workspace
    outside = tmp_path / 'outside'
    outside.mkdir()
    owner_dir = Path(storage.output_dir)
    owner_dir.mkdir(parents=True)
    (owner_dir / 'uploads').symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        asyncio.run(api.upload_media(UploadFile(filename='portrait.jpg', file=BytesIO(b'private')), identity))
    assert list(outside.iterdir()) == []


def test_archive_symlink_escape_and_api_error(workspace, tmp_path, monkeypatch):
    from fastapi import HTTPException
    from src.apps.playground.models import SaveToLibraryRequest
    root, identity, storage = workspace
    path = Path(storage.output_dir) / 'images/image.jpg'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'image')
    storage.add_generation(PlaygroundGeneration(id='g', mode='t2i', model_id='test', prompt='test', created_at='today',
        owner_user_id=identity.user_id, owner_profile_id=identity.owner_profile_id,
        outputs=[PlaygroundOutput(id='o', media_type='image', media_path=str(path))]))
    outside = tmp_path / 'outside'
    outside.mkdir()
    Path(storage.asset_dir).mkdir(parents=True)
    (Path(storage.asset_dir) / 'linked').symlink_to(outside, target_is_directory=True)
    service = PlaygroundService(storage)
    with pytest.raises(ValueError):
        service.save_to_library('g', 'o', 'linked')
    monkeypatch.setattr(api, '_service_for', lambda _: service)
    with pytest.raises(HTTPException) as exc:
        api.save_to_library('g', 'o', SaveToLibraryRequest(category='../escape'), identity)
    assert exc.value.status_code == 400
    assert list(outside.iterdir()) == []


def test_relative_physical_paths_and_remote_inputs(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    storage = PlaygroundStorage(owner_user_id='user', owner_profile_id='owner', output_root='managed-media')
    path = Path(storage.output_dir) / 'uploads/reference.jpg'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'relative image')
    service = PlaygroundService(storage)
    gen = PlaygroundGeneration(id='g', mode='i2v', model_id='test', prompt='test', created_at='today',
                              input_media=[str(path)])
    local, remote = service._resolve_first_input_media(gen)
    assert Path(local).read_bytes() == b'relative image'
    gen.input_media = ['https://example.test/image.jpg']
    assert service._resolve_first_input_media(gen) == (None, gen.input_media[0])
