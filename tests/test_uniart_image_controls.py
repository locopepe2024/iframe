import pytest
from src.models import uniart


@pytest.mark.parametrize('ratio,tier,size', [('16:9', '1k', '1024x576'), ('9:16', '2k', '1152x2048'), ('1:1', '4k', '4096x4096')])
@pytest.mark.parametrize('quality', ['low', 'medium', 'high'])
def test_image_ratio_quality_outbound(monkeypatch, ratio, tier, size, quality):
    captured = {}
    def post(config, endpoint, body):
        captured.update(body)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *args, **kwargs: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *args: None)
    uniart.UniArtImageModel({}).generate('test', 'unused.png', size=tier, aspect_ratio=ratio, quality=quality)
    assert 'size' not in captured
    assert captured['resolution'] == tier
    assert captured['quality'] == quality
    assert captured['aspect_ratio'] == ratio


def test_image_edit_forwards_reference_and_semantic_size(monkeypatch, tmp_path):
    image = tmp_path / 'reference.png'
    image.write_bytes(b'image')
    captured = {}
    def post(config, endpoint, body):
        captured.update(endpoint=endpoint, body=body)
        return {'task_id': 'task'}
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    uniart.UniArtImageModel({}).generate('edit', 'unused.png', size='2k', aspect_ratio='16:9', ref_image_paths=[str(image)])
    assert captured['endpoint'] == '/images/edits'
    assert captured['body']['image'] == ['data:image/png;base64,aW1hZ2U=']
    assert captured['body']['resolution'] == '2k'
    assert 'size' not in captured['body']
