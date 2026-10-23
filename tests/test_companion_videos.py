import shutil
import sqlite3
import subprocess

import pytest
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore
from src.apps.photos import videos


@pytest.fixture
def setup(tmp_path, monkeypatch):
    path = tmp_path / 'photos.db'
    DateStore(path)
    monkeypatch.setenv('IFRAME_PHOTOS_LOCAL_DB_PATH', str(path))
    app = create_app()
    app.dependency_overrides[require_user_context] = lambda: UserContext('actor', 'owner', '', '')
    with TestClient(app) as client:
        yield client, app, tmp_path


@pytest.fixture
def clip(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('ffmpeg/ffprobe required for actual video validation')
    target = tmp_path / 'synthetic.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(target)], check=True, timeout=15)
    return target.read_bytes()


def test_actual_video_upload_retries_original_thumbnail_and_owner_isolation(setup, clip):
    client, app, directory = setup
    result = client.post('/videos/uploads/first?name=test.mp4', content=clip)
    assert result.status_code == 201, result.text
    identifier = result.json()['video_id']
    assert result.json()['created']
    repeat = client.post('/videos/uploads/first?name=test.mp4', content=clip)
    assert repeat.json() == dict(result.json(), created=False)
    assert client.post('/videos/uploads/first?name=other.mp4', content=clip).status_code == 409
    original = client.get(f'/videos/{identifier}/original')
    assert original.content == clip
    assert original.headers['content-type'] == 'video/mp4'
    assert original.headers['cache-control'] == 'private, no-store'
    thumb = client.get(f'/videos/{identifier}/thumbnail')
    assert thumb.content[:4] == b'RIFF' and thumb.content[8:12] == b'WEBP'
    assert client.get('/videos?query=TEST').json()['videos'][0]['video_id'] == identifier
    app.dependency_overrides[require_user_context] = lambda: UserContext('other', 'other', '', '')
    assert client.get('/videos').json()['videos'] == []
    assert client.get(f'/videos/{identifier}/original').status_code == 404
    assert client.get(f'/videos/{identifier}/thumbnail').status_code == 404
    assert client.get(f'/photos/{identifier}/date').status_code == 404
    with sqlite3.connect(directory / 'companion-videos.db') as conn:
        assert conn.execute('SELECT count(*) FROM companion_videos').fetchone()[0] == 1


def test_invalid_oversized_missing_storage_and_invalid_keys(setup, monkeypatch):
    client, _, directory = setup
    assert client.post('/videos/uploads/one?name=bad.mp4', content=b'fake mp4').status_code == 422
    monkeypatch.setattr(videos, 'MAX_BYTES', 10)
    assert client.post('/videos/uploads/two?name=bad.mp4', content=b'x' * 11).status_code == 413
    assert client.post('/videos/uploads/three?name=empty.mp4', content=b'').status_code == 422
    assert client.post('/videos/uploads/bad.key?name=x').status_code == 422
    monkeypatch.delenv('IFRAME_PHOTOS_LOCAL_DB_PATH')
    assert client.get('/videos').status_code == 503


def test_list_pagination_and_literal_filename_search(setup, clip):
    client, _, _ = setup
    ids = [client.post(f'/videos/uploads/{key}?name={name}', content=clip).json()['video_id']
           for key, name in [('one','garden.mp4'),('two','oldstreet.mp4'),('three','100%_test.mp4')]]
    first = client.get('/videos?limit=2').json()
    second = client.get('/videos', params={'limit':2, 'after_id':first['next_after_id']}).json()
    assert {v['video_id'] for v in first['videos'] + second['videos']} == set(ids)
    assert second['next_after_id'] is None
    assert len(client.get('/videos?query=%25_').json()['videos']) == 1
    assert client.get('/videos?query=absent').json()['videos'] == []
