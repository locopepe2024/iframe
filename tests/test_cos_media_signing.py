from src.utils import oss_utils


def test_cos_upload_key_is_signed_when_legacy_oss_prefix_differs(monkeypatch):
    monkeypatch.setenv('OSS_BASE_PATH', 'comic_gen/')
    monkeypatch.setenv('LUMENX_COS_KEY_PREFIX', 'lumenx')
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: True)
    key = 'lumenx/02cf0299-a4e8-4d8d-896a-123220998527.png'
    class Storage:
        is_configured = True
        def sign_url_for_display(self, value):
            assert value == key
            return 'https://storage.example/cover.png?signature=test'
    response = oss_utils.sign_oss_urls_in_data({'image_url': key, 'nested': [{'url': key}], 'local': 'uploads/local.png'}, Storage())
    assert response['image_url'] == 'https://storage.example/cover.png?signature=test'
    assert response['nested'][0]['url'] == response['image_url']
    assert response['local'] == 'uploads/local.png'


def test_oss_prefix_remains_active_without_cos(monkeypatch):
    monkeypatch.setenv('OSS_BASE_PATH', 'comic_gen/')
    monkeypatch.setattr(oss_utils, 'is_cos_configured', lambda: False)
    assert oss_utils.is_object_key('comic_gen/cover.png')
    assert not oss_utils.is_object_key('unrelated/cover.png')
