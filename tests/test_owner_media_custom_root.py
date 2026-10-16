from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from src.apps.media_registry import get_media, list_media, register_media
from src.apps.playground.storage import PlaygroundStorage
from src.apps.playground.models import PlaygroundGeneration, PlaygroundOutput
from src.apps.studio_access import (
    resolve_studio_reference, signed_provider_media_url, studio_media_dir,
    studio_media_preview_url, studio_media_url, studio_owner_key,
    verify_provider_media, verify_studio_media, verify_studio_media_preview,
)


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    cwd = tmp_path / 'cwd'
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    monkeypatch.setenv('PROVIDER_MEDIA_PUBLIC_BASE_URL', 'https://media.example')
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-only-signing-key')
    root = tmp_path / 'managed'
    owner = 'profile-a'
    key = f'users/{studio_owner_key(owner)}/studio/uploads/reference.jpg'
    path = root / key
    path.parent.mkdir(parents=True)
    path.write_bytes(b'reference')
    return root, owner, key, path


def signed_parts(url):
    parsed = urlsplit(url)
    query = parse_qs(parsed.query)
    return parsed.path, int(query['expires'][0]), query['signature'][0]


def test_custom_root_write_sign_resolve_and_renew(workspace):
    root, owner, key, path = workspace
    assert Path(studio_media_dir(owner, 'uploads', output_root=str(root))) == path.parent
    url = studio_media_url(owner, key, output_root=str(root))
    _, expires, signature = signed_parts(url)
    assert verify_studio_media(studio_owner_key(owner), 'uploads/reference.jpg', expires, signature,
                               output_root=str(root)) == str(path)
    assert resolve_studio_reference(url, owner, output_root=str(root)) == key
    expired = studio_media_url(owner, key, ttl_seconds=-1, output_root=str(root))
    assert resolve_studio_reference(expired, owner, output_root=str(root)) == key
    renewed = studio_media_url(owner, expired, output_root=str(root))
    assert signed_parts(renewed)[1] > signed_parts(expired)[1]
    for locator in (key, 'output/' + key, str(path), '/files/' + key,
                    f'/studio/owned-media/{studio_owner_key(owner)}/uploads/reference.jpg'):
        assert resolve_studio_reference(locator, owner, output_root=str(root)) == key
    with pytest.raises(ValueError):
        resolve_studio_reference(url, 'another-owner', output_root=str(root))
    with pytest.raises(ValueError):
        resolve_studio_reference(url, owner, output_root=str(root / 'wrong'))


def test_upstream_signed_bytes_and_signature_independent_of_root(workspace):
    root, owner, key, path = workspace
    url = signed_provider_media_url(key, output_root=str(root))
    _, expires, signature = signed_parts(url)
    resolved = verify_provider_media(studio_owner_key(owner), 'studio/uploads/reference.jpg', expires,
                                     signature, output_root=str(root))
    assert Path(resolved).read_bytes() == b'reference'
    with pytest.raises(HTTPException):
        verify_provider_media(studio_owner_key(owner), 'studio/uploads/reference.jpg', expires,
                              signature + 'x', output_root=str(root))
    with pytest.raises(HTTPException):
        verify_provider_media(studio_owner_key(owner), 'studio/uploads/reference.jpg', expires,
                              signature, output_root=str(root / 'wrong'))
    with pytest.raises(HTTPException):
        verify_provider_media(studio_owner_key('another'), 'studio/uploads/reference.jpg', expires,
                              signature, output_root=str(root))


def test_studio_preview_resolves_same_root(workspace):
    root, owner, key, path = workspace
    url = studio_media_preview_url(owner, key)
    _, expires, signature = signed_parts(url)
    assert verify_studio_media_preview(studio_owner_key(owner), 'uploads/reference.jpg', 320,
                                       expires, signature, output_root=str(root)) == str(path)


def test_playground_storage_and_registry_persist_in_selected_root(workspace):
    root, owner, key, path = workspace
    args = dict(owner_user_id='user-a', owner_profile_id=owner, output_root=str(root))
    storage = PlaygroundStorage(**args)
    session = storage.create_session('Custom root')
    upload = Path(storage.output_dir) / 'uploads' / 'input.jpg'
    upload.parent.mkdir(parents=True)
    upload.write_bytes(b'input')
    assert storage.resolve_media_reference('/playground/input-media/input.jpg') == str(upload)
    assert storage.resolve_media_reference(studio_media_url(owner, key)) == str(path)
    generation = PlaygroundGeneration(id='generation', mode='t2i', model_id='test', prompt='test',
        created_at='2026-10-16T00:00:00Z', session_id=session.id,
        owner_user_id='user-a', owner_profile_id=owner,
        outputs=[PlaygroundOutput(id='image', media_path=str(upload), media_type='image')])
    storage.add_generation(generation)
    reloaded = PlaygroundStorage(**args)
    assert reloaded._sessions[0].id == session.id
    assert reloaded.resolve_media_reference('/playground/media/generation/image') == str(upload)
    assert reloaded.browser_media_reference(str(upload)) == '/playground/media/generation/image'
    media_id = register_media(owner, key, kind='temporary_input', output_root=str(root))
    assert get_media(owner, media_id, output_root=str(root))['storage_key'] == key
    assert list_media(owner, output_root=str(root))[0]['media_id'] == media_id
    assert get_media('another', media_id, output_root=str(root)) is None
    assert get_media(owner, media_id, output_root=str(root / 'wrong')) is None
    assert not Path('output').exists()


def test_custom_root_rejects_traversal_and_escaping_file_symlink(workspace):
    root, owner, key, path = workspace
    outside = root.parent / 'private.jpg'
    outside.write_bytes(b'private')
    path.unlink()
    path.symlink_to(outside)
    with pytest.raises(ValueError):
        signed_provider_media_url(key, output_root=str(root))
    with pytest.raises(ValueError):
        resolve_studio_reference(key, owner, output_root=str(root))
    with pytest.raises(ValueError):
        resolve_studio_reference('output/../private.jpg', owner, output_root=str(root))


def test_symlinked_owner_tree_cannot_escape_custom_root(workspace):
    root, owner, key, path = workspace
    outside = root.parent / 'outside'
    outside.mkdir()
    other = 'profile-symlink'
    (root / 'users' / studio_owner_key(other)).symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        studio_media_dir(other, 'uploads', output_root=str(root))
    with pytest.raises(ValueError):
        PlaygroundStorage(owner_user_id='user', owner_profile_id=other, output_root=str(root))
    with pytest.raises(ValueError):
        register_media(other, 'a.jpg', kind='test', output_root=str(root))


def test_registry_and_input_file_symlink_escape_rejected(workspace):
    root, owner, key, path = workspace
    storage = PlaygroundStorage(owner_user_id='user', owner_profile_id=owner, output_root=str(root))
    upload = Path(storage.output_dir) / 'uploads' / 'input.jpg'
    upload.parent.mkdir(parents=True)
    outside = root.parent / 'outside.jpg'
    outside.write_bytes(b'outside')
    upload.symlink_to(outside)
    with pytest.raises(ValueError):
        storage.resolve_media_reference('/playground/input-media/input.jpg')
    registry = root / 'users' / studio_owner_key(owner) / 'media-registry.sqlite3'
    registry.symlink_to(outside)
    with pytest.raises(ValueError):
        get_media(owner, 'id', output_root=str(root))


def test_relative_custom_root_paths_roundtrip(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('PROVIDER_MEDIA_PUBLIC_BASE_URL', 'https://media.example')
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-only-signing-key')
    directory = studio_media_dir('owner', 'uploads', output_root='custom-media')
    path = Path(directory) / 'image.jpg'
    path.parent.mkdir(parents=True)
    path.write_bytes(b'image')
    assert resolve_studio_reference(str(path), 'owner', output_root='custom-media') == (
        f'users/{studio_owner_key("owner")}/studio/uploads/image.jpg'
    )
    _, expires, signature = signed_parts(signed_provider_media_url(str(path), output_root='custom-media'))
    assert Path(verify_provider_media(studio_owner_key('owner'), 'studio/uploads/image.jpg',
                                     expires, signature, output_root='custom-media')).read_bytes() == b'image'
