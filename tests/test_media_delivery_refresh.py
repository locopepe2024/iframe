from pathlib import Path
import subprocess
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from PIL import Image

from src.apps.identity import UserContext
from src.apps.media_registry import register_media
from src.apps.playground import api as playground_api
from src.apps.playground.models import PlaygroundGeneration, PlaygroundOutput
from src.apps.playground.storage import PlaygroundStorage
from src.apps.studio_access import studio_media_url, studio_owner_key


def owner(profile):
    return UserContext(user_id=profile, owner_profile_id=profile, display_name='', access_token='')


def test_playground_delivery_refresh_requires_owned_existing_output(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    storage = PlaygroundStorage(owner_user_id='a', owner_profile_id='a')
    image = Path(storage.output_dir) / 'images' / 'result.png'
    image.parent.mkdir(parents=True)
    Image.new('RGB', (32, 32)).save(image)
    generation = PlaygroundGeneration(id='generation', mode='t2i', model_id='model', prompt='test',
        created_at='2026-10-16', owner_user_id='a', owner_profile_id='a',
        outputs=[PlaygroundOutput(id='output', media_path=str(image), media_type='image')])
    storage.add_generation(generation)
    other = PlaygroundStorage(owner_user_id='b', owner_profile_id='b')
    monkeypatch.setattr(playground_api, '_storage_for', lambda ctx: storage if ctx.owner_profile_id == 'a' else other)
    fresh = playground_api.get_generation_media_url('generation', 'output', 0, owner('a'))['url']
    assert fresh.startswith('/playground/media/generation/output?')
    assert int(parse_qs(urlsplit(fresh).query)['expires'][0]) > 1
    with pytest.raises(HTTPException) as foreign:
        playground_api.get_generation_media_url('generation', 'output', 0, owner('b'))
    assert foreign.value.status_code == 404
    image.unlink()
    with pytest.raises(HTTPException) as missing:
        playground_api.get_generation_media_url('generation', 'output', 0, owner('a'))
    assert missing.value.status_code == 404


def test_studio_delivery_refreshes_expired_source_and_webp_cover(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/uploads/source.png'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    Image.new('RGB', (64, 40)).save(source)
    expired = studio_media_url('a', stored, ttl_seconds=-1)
    source_response = studio_api.refresh_studio_media_delivery(expired, 0, owner('a'))
    cover_response = studio_api.refresh_studio_media_delivery(expired, 320, owner('a'))
    assert 'signature=' in source_response.body.decode()
    assert 'preview=320' in cover_response.body.decode()
    assert 'image/webp' in cover_response.body.decode()
    with pytest.raises(HTTPException) as foreign:
        studio_api.refresh_studio_media_delivery(expired, 320, owner('b'))
    assert foreign.value.status_code == 404


def test_playground_cover_is_cached_webp_and_tracks_source_revision(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    storage = PlaygroundStorage(owner_user_id='a', owner_profile_id='a')
    source = Path(storage.output_dir) / 'images' / 'result.png'
    source.parent.mkdir(parents=True)
    Image.new('RGB', (640, 360), 'red').save(source)
    generation = PlaygroundGeneration(id='g', mode='t2i', model_id='model', prompt='test',
        created_at='2026-10-16', owner_user_id='a', owner_profile_id='a',
        outputs=[PlaygroundOutput(id='o', media_path=str(source), media_type='image')])
    storage.add_generation(generation)
    monkeypatch.setattr(playground_api, '_storage_for', lambda _: storage)
    monkeypatch.setattr(playground_api, '_storages', {'a': storage})
    delivery = playground_api.get_generation_media_url('g', 'o', 1, owner('a'))['url']
    parsed = urlsplit(delivery)
    query = parse_qs(parsed.query)
    response = playground_api.get_generation_media('g', 'o', 1, int(query['expires'][0]),
        query['signature'][0], None, None)
    assert response.media_type == 'image/webp'
    first = Path(response.path)
    with Image.open(first) as image:
        assert image.format == 'WEBP'
        assert max(image.size) == 320
    Image.new('RGB', (640, 360), 'blue').save(source)
    changed = playground_api.get_generation_media('g', 'o', 1, int(query['expires'][0]),
        query['signature'][0], None, None)
    assert changed.path != str(first)


def test_asset_variant_delivery_refreshes_by_owner_and_variant(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/assets/portrait.png'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    Image.new('RGB', (16, 16)).save(source)
    variant = SimpleNamespace(id='v1', storage_key=stored, url=stored)
    asset = SimpleNamespace(id='asset', variants=[variant])
    monkeypatch.setattr(studio_api.pipeline, '_library_list_for_type', lambda kind, profile: [asset] if kind == 'character' and profile == 'a' else [])
    monkeypatch.setattr(studio_api.pipeline, '_asset_image_variants', lambda item, kind: item.variants)
    response = studio_api.get_asset_library_delivery('global', 'character', 'asset', 'v1', '', owner('a'))
    assert '/studio/media/' in response.body.decode()
    assert response.headers['Cache-Control'] == 'private, no-store'
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_asset_library_delivery('global', 'character', 'asset', 'v1', '', owner('b'))
    assert foreign.value.status_code == 404


def test_registered_video_delivery_uses_owner_media_id(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/video/take.mp4'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    source.write_bytes(b'video')
    media_id = register_media('a', stored, kind='video_task', output_root='output')
    response = studio_api.get_registered_media_delivery(media_id, user=owner('a'))
    assert '/studio/media/' in response.body.decode()
    with pytest.raises(HTTPException) as unsupported:
        studio_api.get_registered_media_delivery(media_id, preview=321, user=owner('a'))
    assert unsupported.value.status_code == 422
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_registered_media_delivery(media_id, user=owner('b'))
    assert foreign.value.status_code == 404
    source.unlink()
    with pytest.raises(HTTPException) as missing:
        studio_api.get_registered_media_delivery(media_id, user=owner('a'))
    assert missing.value.status_code == 404


def test_registered_image_cover_is_owner_scoped_webp(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/uploads/portrait.png'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    Image.new('RGB', (640, 360)).save(source)
    media_id = register_media('a', stored, kind='image', output_root='output')
    response = studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
    assert 'preview=320' in response.body.decode()
    assert 'image/webp' in response.body.decode()
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('b'))
    assert foreign.value.status_code == 404


def test_registered_cos_cover_tracks_object_revision_and_reuses_cached_webp(tmp_path, monkeypatch):
    from io import BytesIO
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    key = 'lumenx/users/a/studio/images/portrait.png'
    image = BytesIO()
    Image.new('RGB', (640, 360), 'red').save(image, format='PNG')

    class Body:
        def __init__(self, data):
            self.data = data

        def get_stream(self, chunk_size=1024):
            yield self.data

        def get_raw_stream(self):
            return BytesIO(self.data)

    class Client:
        def __init__(self):
            self.content = image.getvalue()
            self.etag = 'revision-one'
            self.download_count = 0

        def head_object(self, **kwargs):
            return {'ETag': self.etag, 'Content-Length': str(len(self.content)),
                    'Last-Modified': 'Fri, 16 Oct 2026 00:00:00 GMT'}

        def get_object(self, **kwargs):
            assert kwargs['IfMatch'] == self.etag
            self.download_count += 1
            return {'Body': Body(self.content)}

    client = Client()
    uploader = SimpleNamespace(is_configured=True, client=client, bucket_name='bucket')
    monkeypatch.setattr(studio_api, 'OSSImageUploader', lambda: uploader)
    monkeypatch.setattr(studio_api, 'is_cos_configured', lambda: True)
    monkeypatch.setattr(studio_api, 'is_object_key', lambda value: value == key)
    media_id = register_media('a', key, kind='image', output_root='output')

    first = studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
    same = studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
    assert first.body == same.body
    assert client.download_count == 1
    assert 'image/webp' in first.body.decode()
    cover_name = first.body.decode().split('/.cos-previews/')[1].split('.webp')[0] + '.webp'
    cover_path = Path('output') / 'users' / studio_owner_key('a') / 'studio' / '.cos-previews' / cover_name
    with Image.open(cover_path) as cover:
        assert cover.format == 'WEBP'
        assert cover.size == (320, 180)
    client.etag = 'revision-two'
    updated = BytesIO()
    Image.new('RGB', (640, 360), 'blue').save(updated, format='PNG')
    client.content = updated.getvalue()
    changed = studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
    assert changed.body != first.body
    assert client.download_count == 2
    changed_name = changed.body.decode().split('/.cos-previews/')[1].split('.webp')[0] + '.webp'
    with Image.open(cover_path.with_name(changed_name)) as cover:
        assert cover.getpixel((100, 100))[2] > 200
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('b'))
    assert foreign.value.status_code == 404

    original_head = client.head_object
    client.head_object = lambda **kwargs: {**original_head(**kwargs), 'Content-Length': str(600 * 1024 * 1024)}
    client.etag = 'too-large'
    with pytest.raises(HTTPException) as oversized:
        studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
    assert oversized.value.status_code == 415
    assert client.download_count == 2

    class CosError(Exception):
        def __init__(self, status):
            self.status = status

        def get_status_code(self):
            return self.status

    for status, expected in ((404, 404), (412, 409)):
        client.head_object = lambda **kwargs: (_ for _ in ()).throw(CosError(status))
        with pytest.raises(HTTPException) as failed:
            studio_api.get_registered_media_delivery(media_id, preview=320, user=owner('a'))
        assert failed.value.status_code == expected


def test_cos_cover_refuses_owner_cache_symlink(tmp_path):
    from src.utils.cos_previews import create_cos_media_preview

    root = tmp_path / 'owner'
    root.mkdir()
    outside = tmp_path / 'outside'
    outside.mkdir()
    (root / '.cos-previews').symlink_to(outside, target_is_directory=True)
    uploader = SimpleNamespace(is_configured=True)
    with pytest.raises(ValueError, match='outside its owner'):
        create_cos_media_preview(uploader, 'lumenx/image.png', str(root), 320)
    assert not list(outside.iterdir())


def test_cos_video_cover_decodes_first_frame(tmp_path):
    from io import BytesIO
    from src.utils.cos_previews import create_cos_media_preview
    from src.utils.system_check import get_ffmpeg_path

    ffmpeg = get_ffmpeg_path()
    if not ffmpeg:
        pytest.skip('FFmpeg required')
    source = tmp_path / 'clip.mp4'
    subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i',
                    'color=red:s=640x360:d=0.1', '-threads', '1', '-y', str(source)],
                   check=True, capture_output=True, timeout=15)
    content = source.read_bytes()

    class Client:
        def head_object(self, **kwargs):
            return {'ETag': 'video-revision', 'Content-Length': str(len(content))}

        def get_object(self, **kwargs):
            assert kwargs['IfMatch'] == 'video-revision'
            stream = BytesIO(content)
            return {'Body': SimpleNamespace(
                get_stream=lambda chunk_size: iter([content]), get_raw_stream=lambda: stream)}

    uploader = SimpleNamespace(is_configured=True, client=Client(), bucket_name='bucket')
    cover = create_cos_media_preview(uploader, 'lumenx/clip.mp4', str(tmp_path / 'owner'), 320)
    with Image.open(cover) as image:
        assert image.format == 'WEBP'
        assert image.size == (320, 180)
        assert image.getpixel((100, 100))[0] > 200


def test_video_task_delivery_supports_legacy_task_without_media_id(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/video/legacy.mp4'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    source.write_bytes(b'video')
    task = SimpleNamespace(id='task', status='completed', video_url=stored)
    script = SimpleNamespace(video_tasks=[task])
    monkeypatch.setattr(studio_api.pipeline, 'get_script', lambda project, profile: script if (project, profile) == ('p', 'a') else None)
    response = studio_api.get_video_task_delivery('p', 'task', user=owner('a'))
    assert '/studio/media/' in response.body.decode()
    cover = studio_api.get_video_task_delivery('p', 'task', preview=320, user=owner('a'))
    assert 'preview=320' in cover.body.decode()
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_video_task_delivery('p', 'task', user=owner('b'))
    assert foreign.value.status_code == 404


def test_assembly_output_delivery_uses_current_project_output(tmp_path, monkeypatch):
    from src.apps.comic_gen import api as studio_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    stored = f'users/{studio_owner_key("a")}/studio/export/final.mp4'
    source = Path('output') / stored
    source.parent.mkdir(parents=True)
    source.write_bytes(b'video')
    project = SimpleNamespace(merged_video_url=stored)
    monkeypatch.setattr(studio_api.pipeline, 'get_script', lambda project_id, profile: project if (project_id, profile) == ('p', 'a') else None)
    response = studio_api.get_merged_video_delivery('p', user=owner('a'))
    assert '/studio/media/' in response.body.decode()
    cover = studio_api.get_merged_video_delivery('p', preview=320, user=owner('a'))
    assert 'preview=320' in cover.body.decode()
    with pytest.raises(HTTPException) as foreign:
        studio_api.get_merged_video_delivery('p', user=owner('b'))
    assert foreign.value.status_code == 404


def test_agent_message_projects_fresh_url_without_mutating_history(tmp_path, monkeypatch):
    from src.apps import agent_api

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    storage = PlaygroundStorage(owner_user_id='a', owner_profile_id='a')
    source = Path(storage.output_dir) / 'images' / 'agent.png'
    source.parent.mkdir(parents=True)
    Image.new('RGB', (16, 16)).save(source)
    generation = PlaygroundGeneration(id='g', mode='t2i', model_id='model', prompt='test',
        created_at='2026-10-16', owner_user_id='a', owner_profile_id='a',
        outputs=[PlaygroundOutput(id='o', media_path=str(source), media_type='image')])
    storage.add_generation(generation)
    monkeypatch.setattr(playground_api, '_storage_for', lambda _: storage)
    original = {'role': 'user', 'input_media': ['/playground/media/g/o?expires=1&signature=old']}
    projected = agent_api.public_media_messages([original], owner('a'))[0]
    assert 'signature=old' not in projected['input_media'][0]
    assert original['input_media'][0].endswith('signature=old')
