from types import SimpleNamespace

import pytest

from src.utils import cos_storage, oss_utils


@pytest.fixture(autouse=True)
def reset_adapters():
    oss_utils.OSSImageUploader.reset_instance()
    yield
    oss_utils.OSSImageUploader.reset_instance()


def test_explicit_oss_prevents_credential_driven_cos_selection(monkeypatch):
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', 'oss')
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: True)
    monkeypatch.setattr(oss_utils, 'COSImageUploader', lambda: pytest.fail('COS selected'))
    monkeypatch.setattr(oss_utils.OSSImageUploader, '__init__', lambda self: None)
    assert isinstance(oss_utils.OSSImageUploader(), oss_utils.OSSImageUploader)


@pytest.mark.parametrize('backend', ['local', 'cos'])
def test_non_oss_backend_cannot_write_oss(monkeypatch, backend, tmp_path):
    monkeypatch.setenv('IFRAME_STORAGE_BACKEND', backend)
    adapter = object.__new__(oss_utils.OSSImageUploader)
    adapter.bucket = SimpleNamespace(put_object=lambda *args: pytest.fail('unexpected OSS write'))
    assert adapter.upload_file(str(tmp_path / 'input.jpg')) is None


@pytest.mark.parametrize('backend', ['local', 'oss'])
def test_non_cos_backend_cannot_write_cos_but_can_sign(monkeypatch, backend):
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
    assert adapter.sign_url_for_api('old/key.jpg') == 'https://cos.example/signed'


def test_unset_preserves_legacy_cos_selection(monkeypatch):
    monkeypatch.delenv('IFRAME_STORAGE_BACKEND', raising=False)
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: True)
    expected = SimpleNamespace()
    monkeypatch.setattr(oss_utils, 'COSImageUploader', lambda: expected)
    assert oss_utils.OSSImageUploader() is expected


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
