import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps.playground import api
from src.apps import identity


@pytest.fixture(params=['png', 'mp4'])
def client(tmp_path, monkeypatch, request):
    image = tmp_path / f'media.{request.param}'
    image.write_bytes(b'owned-image')
    output = SimpleNamespace(id='output', media_path=str(image), thumbnail_path=None)
    generation = SimpleNamespace(outputs=[output])
    monkeypatch.setattr(api, '_storage_for', lambda owner: SimpleNamespace(
        get_generation=lambda gid: generation if owner.owner_profile_id == 'browser-owner' and gid == 'generation' else None))
    monkeypatch.setattr(api, '_storages', {})
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    with TestClient(app) as session:
        yield session


def test_browser_owner_can_download_original_without_signed_preview(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    response = client.get('/playground/media/generation/output')
    assert response.status_code == 200
    assert response.content == b'owned-image'


def test_signed_preview_uses_browser_cookie_across_workers(client, monkeypatch):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    expires = 4_000_000_000
    signature = api._media_signature('browser-owner', 'generation', 'output', 0, expires)
    response = client.get(
        f'/playground/media/generation/output?expires={expires}&signature={signature}'
    )
    assert response.status_code == 200
    assert response.content == b'owned-image'


def test_browser_owner_cannot_download_another_owners_file(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'other')
    assert client.get('/playground/media/generation/output').status_code == 404


def test_no_identity_does_not_create_anonymous_owner_to_download(client):
    assert client.get('/playground/media/generation/output').status_code == 401


def test_expired_signed_preview_is_not_rescued_by_cookie(client):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    assert client.get('/playground/media/generation/output?expires=1&signature=expired').status_code == 401


def test_invalid_bearer_is_not_rescued_by_cookie(client, monkeypatch):
    client.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
    monkeypatch.setattr(identity.UniArtIdentityClient, 'me', Mock(side_effect=HTTPException(401, 'expired')))
    assert client.get('/playground/media/generation/output', headers={'Authorization': 'Bearer invalid'}).status_code == 401


@pytest.mark.skipif(shutil.which('ffmpeg') is None, reason='ffmpeg is required for video covers')
def test_video_cover_is_cached_and_original_remains_downloadable(tmp_path, monkeypatch):
    video = tmp_path / 'media.mp4'
    subprocess.run([
        'ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=2',
        '-t', '1', '-pix_fmt', 'yuv420p', str(video),
    ], check=True)
    output = SimpleNamespace(id='output', media_path=str(video), media_type='video', thumbnail_path=None)
    generation = SimpleNamespace(outputs=[output])
    monkeypatch.setattr(api, '_storage_for', lambda owner: SimpleNamespace(get_generation=lambda gid: generation))
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    with TestClient(app) as session:
        session.cookies.set(identity.BROWSER_PROFILE_COOKIE, 'owner')
        first = session.get('/playground/media/generation/output?thumbnail=1')
        cover = tmp_path / 'media.mp4.cover.jpg'
        assert first.status_code == 200
        assert first.headers['content-type'] == 'image/jpeg'
        assert first.content.startswith(b'\xff\xd8')
        cached_mtime = cover.stat().st_mtime_ns
        second = session.get('/playground/media/generation/output?thumbnail=1')
        assert second.content == first.content
        assert cover.stat().st_mtime_ns == cached_mtime
        original = session.get('/playground/media/generation/output')
        assert original.status_code == 200
        assert original.headers['content-type'] == 'video/mp4'
        assert original.content == video.read_bytes()
