import json

import pytest
from src.models import uniart


@pytest.mark.parametrize('mode', ['i2v', 'f2v', 'r2v', 'v2v'])
def test_large_video_image_references_are_urls_not_inline_bytes(tmp_path, monkeypatch, mode):
    from src.utils import oss_utils
    image = tmp_path / 'large.png'
    image.write_bytes(b'x' * (2 * 1024 * 1024))
    class Storage:
        is_configured = True
        def upload_file(self, path, sub_path):
            assert path == str(image)
            return 'materials/image.png'
        def sign_url_for_api(self, key):
            return 'https://storage.example/image.png?signature=test'
    monkeypatch.setattr(oss_utils, 'OSSImageUploader', Storage)
    def post(config, endpoint, body):
        assert endpoint == '/videos'
        assert len(json.dumps(body).encode()) < 2048
        assert 'data:' not in json.dumps(body)
        urls = [c[c['type']]['url'] for c in body['content']] if mode != 'i2v' else [body['input_reference']]
        assert all(url.startswith('https://storage.example/') for url in urls)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    kwargs = {
        'i2v': {'img_path': str(image)},
        'f2v': {'first_frame': str(image), 'last_frame': str(image)},
        'r2v': {'ref_image_urls': [str(image), str(image)]},
        'v2v': {'ref_video_urls': [str(image), str(image)]},
    }[mode]
    uniart.UniArtVideoModel({}).generate('walk', str(tmp_path / 'result.mp4'), model='minimax-h3', **kwargs)


def test_video_material_storage_failure_prevents_submission(monkeypatch, tmp_path):
    from src.utils import oss_utils
    monkeypatch.setattr(oss_utils, 'OSSImageUploader', lambda: type('Storage', (), {'is_configured': False})())
    monkeypatch.setattr(uniart, '_post', lambda *a: pytest.fail('must not submit without material URL'))
    image = tmp_path / 'ref.png'
    image.write_bytes(b'image')
    with pytest.raises(RuntimeError, match='storage is not configured'):
        uniart.UniArtVideoModel({}).generate('walk', str(tmp_path / 'result.mp4'), img_path=str(image))


@pytest.mark.parametrize('model', ['minimax-h3-vip', 'seedance-2.5-vip', 'kling', 'vidu', 'wan', 'happyhorse', 'pixverse'])
@pytest.mark.parametrize('mode', ['t2v', 'i2v', 'r2v', 'f2v', 'v2v'])
def test_playground_preserves_video_model_and_all_url_references(monkeypatch, tmp_path, model, mode):
    from unittest.mock import Mock
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.models import PlaygroundGeneration
    refs = [] if mode == 't2v' else ['https://storage.example/a.mp4' if mode == 'v2v' else 'https://storage.example/a.png']
    if mode in {'r2v', 'f2v', 'v2v'}:
        refs.append('https://storage.example/b.mp4' if mode == 'v2v' else 'https://storage.example/b.png')
    gen = PlaygroundGeneration(id='test', model_id='uniart/' + model, mode=mode, prompt='walk', input_media=refs, created_at='2026-09-16', parameters={})
    storage = Mock(output_dir=str(tmp_path))
    service = PlaygroundService(storage, provider_config_loader=lambda: {})
    monkeypatch.delenv('UNIART_BASE_URL', raising=False)
    monkeypatch.delenv('OPENAI_BASE_URL', raising=False)
    storage.get_generation.return_value = gen
    captured = []
    def post(config, endpoint, body):
        assert body['model'] == model
        assert endpoint == '/videos'
        assert 'data:' not in json.dumps(body)
        if mode in {'r2v', 'f2v', 'v2v'}:
            urls = [c[c['type']]['url'] for c in body['content']]
            assert urls == refs
        elif mode == 'i2v':
            assert body['input_reference'] == refs[0]
        else:
            assert 'input_reference' not in body and 'content' not in body
        captured.append(body)
        return {'task_id': 'accepted'}
    def poll(config, task_id, **kwargs):
        assert task_id == 'accepted'
        return {}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    service._process_video_generation(gen)
    assert len(captured) == 1
