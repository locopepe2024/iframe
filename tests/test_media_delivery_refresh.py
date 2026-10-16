from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from PIL import Image

from src.apps.identity import UserContext
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
