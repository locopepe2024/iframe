import json

import pytest
from src.models import uniart


@pytest.mark.parametrize('frames', [False, True])
def test_large_video_image_references_are_urls_not_inline_bytes(tmp_path, monkeypatch, frames):
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
        urls = [c['image_url']['url'] for c in body['content']] if frames else [body['input_reference']]
        assert all(url.startswith('https://storage.example/') for url in urls)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    kwargs = {'first_frame': str(image), 'last_frame': str(image)} if frames else {'img_path': str(image)}
    uniart.UniArtVideoModel({}).generate('walk', str(tmp_path / 'result.mp4'), model='minimax-h3', **kwargs)


def test_video_material_storage_failure_prevents_submission(monkeypatch, tmp_path):
    from src.utils import oss_utils
    monkeypatch.setattr(oss_utils, 'OSSImageUploader', lambda: type('Storage', (), {'is_configured': False})())
    monkeypatch.setattr(uniart, '_post', lambda *a: pytest.fail('must not submit without material URL'))
    image = tmp_path / 'ref.png'
    image.write_bytes(b'image')
    with pytest.raises(RuntimeError, match='storage is not configured'):
        uniart.UniArtVideoModel({}).generate('walk', str(tmp_path / 'result.mp4'), img_path=str(image))
