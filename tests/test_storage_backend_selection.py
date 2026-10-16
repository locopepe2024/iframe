from types import SimpleNamespace

import pytest

from src.utils import cos_storage, oss_utils


@pytest.fixture(autouse=True)
def reset_adapters():
    oss_utils.OSSImageUploader.reset_instance()
    yield
    oss_utils.OSSImageUploader.reset_instance()


def test_local_does_not_select_cos_adapter(monkeypatch):
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'local')
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: True)
    monkeypatch.setattr(oss_utils, 'COSImageUploader', lambda: pytest.fail('COS selected'))
    monkeypatch.setattr(oss_utils.OSSImageUploader, '__init__', lambda self: None)
    assert isinstance(oss_utils.OSSImageUploader(), oss_utils.OSSImageUploader)


@pytest.mark.parametrize('backend', ['local', 'cos'])
def test_supported_backend_cannot_write_oss(monkeypatch, backend, tmp_path):
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', backend)
    adapter = object.__new__(oss_utils.OSSImageUploader)
    adapter.bucket = SimpleNamespace(put_object=lambda *args: pytest.fail('unexpected OSS write'))
    assert adapter.upload_file(str(tmp_path / 'input.jpg')) is None


def test_local_cannot_write_or_sign_cos(monkeypatch):
    backend = 'local'
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', backend)
    adapter = object.__new__(cos_storage.COSImageUploader)
    adapter.client = SimpleNamespace(
        put_object=lambda **kwargs: pytest.fail('unexpected COS write'),
        get_presigned_url=lambda **kwargs: 'https://cos.example/signed',
    )
    adapter.bucket_name = 'bucket'
    adapter.region = 'region'
    adapter._url_cache = {}
    assert adapter.upload_file('input.jpg') is None
    assert adapter.sign_url_for_api('old/key.jpg') == ''


def test_local_rejects_old_cloud_media_at_delivery(monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api

    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'local')
    monkeypatch.setattr(api, 'is_object_key', lambda value: value == 'lumenx/old-cos.jpg')
    for preview in (0, 320):
        with pytest.raises(HTTPException) as error:
            if preview:
                api._owned_media_cover_url('lumenx/old-cos.jpg', 'owner', preview)
            else:
                api._owned_media_delivery_url('lumenx/old-cos.jpg', 'owner')
        assert error.value.status_code == 404


def test_cos_rejects_local_media_at_delivery(monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api

    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'cos')
    monkeypatch.setattr(api, 'is_object_key', lambda value: False)
    monkeypatch.setattr(api.pipeline, '_resolve_stored_reference_value', lambda value, owner: '/tmp/old-local.jpg')
    for preview in (0, 320):
        with pytest.raises(HTTPException) as error:
            if preview:
                api._owned_media_cover_url('users/old-local.jpg', 'owner', preview)
            else:
                api._owned_media_delivery_url('users/old-local.jpg', 'owner')
        assert error.value.status_code == 404


def test_oss_backend_cannot_be_saved_or_started(monkeypatch):
    from pydantic import ValidationError
    from src.apps.comic_gen.api import EnvConfig
    from src.utils.storage_config import storage_backend

    with pytest.raises(ValidationError):
        EnvConfig(IFRAME_STORAGE_BACKEND='oss')
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'oss')
    with pytest.raises(ValueError, match='IFRAME_STORAGE_BACKEND'):
        storage_backend()


def test_unset_preserves_legacy_cos_selection(monkeypatch):
    monkeypatch.delenv('IFRAME_STORAGE_BACKEND', raising=False)
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: True)
    expected = SimpleNamespace()
    monkeypatch.setattr(oss_utils, 'COSImageUploader', lambda: expected)
    assert oss_utils.OSSImageUploader() is expected


@pytest.mark.parametrize(
    ('selected', 'cos_configured', 'expected'),
    [(None, True, 'cos'), (None, False, 'local'), ('local', True, 'local'), ('cos', True, 'cos')],
)
def test_settings_reports_effective_storage_backend(monkeypatch, selected, cos_configured, expected):
    from src.apps.comic_gen import api

    if selected is None:
        monkeypatch.delenv('IFRAME_STORAGE_BACKEND', raising=False)
    else:
        monkeypatch.setenv('IFRAME_STORAGE_BACKEND', selected)
    monkeypatch.setattr(api, 'is_cos_configured', lambda: cos_configured)

    assert api.get_env_config(identity=None)['IFRAME_STORAGE_BACKEND'] == expected


def test_project_cover_uses_current_webp_delivery(monkeypatch):
    from types import SimpleNamespace
    from src.apps.comic_gen import api

    frame = SimpleNamespace(rendered_image_url="lumenx/frames/first.png", image_url=None)
    script = SimpleNamespace(frames=[frame], scenes=[])
    monkeypatch.setattr(api, '_owned_media_cover_url', lambda value, owner, preview: f'/cover/{owner}/{preview}.webp')
    assert api._project_cover_url(script, 'owner-1') == '/cover/owner-1/320.webp'


def test_project_asset_covers_use_webp_delivery(monkeypatch):
    from src.apps.comic_gen import api

    payload = {
        'characters': [],
        'scenes': [{'id': 'scene-1', 'image_url': 'lumenx/scenes/scene.png'}],
        'props': [{'id': 'prop-1', 'image_url': 'lumenx/props/prop.jpg'}],
    }
    monkeypatch.setattr(api, '_owned_media_cover_url', lambda value, owner, preview: f'/preview/{preview}.webp')
    api._add_asset_cover_urls(payload, 'owner-1')
    assert payload['scenes'][0]['cover_url'] == '/preview/160.webp'
    assert payload['props'][0]['cover_url'] == '/preview/160.webp'


def test_admin_storage_settings_persist_without_live_cutover(monkeypatch):
    from src.apps.comic_gen import api
    monkeypatch.setenv('LUMENX_ENABLE_ADMIN_ENV_CONFIG', 'true')
    monkeypatch.setenv('LUMENX_ADMIN_CONFIG_TOKEN', 'test-admin')
    monkeypatch.setenv('IFRAME_MEDIA_ROOT', 'current-media')
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'cos')
    monkeypatch.setenv('PROVIDER_MEDIA_URL_TTL_SECONDS', '1800')
    persisted = {}
    monkeypatch.setattr(api, 'save_user_config', persisted.update)
    monkeypatch.setattr(api, 'remove_user_config_keys', lambda keys: None)
    result = api.update_env_config(api.EnvConfig(
        IFRAME_MEDIA_ROOT='next-media', IFRAME_STORAGE_BACKEND='local',
        PROVIDER_MEDIA_URL_TTL_SECONDS=7200,
    ), identity=None, x_lumenx_admin_token='test-admin')
    assert result['restart_required'] is True
    assert persisted == {
        'IFRAME_MEDIA_ROOT': 'next-media', 'IFRAME_STORAGE_BACKEND': 'local',
        'PROVIDER_MEDIA_URL_TTL_SECONDS': '7200',
    }
    import os
    assert os.environ['IFRAME_MEDIA_ROOT'] == 'current-media'
    assert os.environ['IFRAME_STORAGE_BACKEND'] == 'cos'
    assert os.environ['PROVIDER_MEDIA_URL_TTL_SECONDS'] == '1800'
