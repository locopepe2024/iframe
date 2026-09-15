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
    assert captured['size'] == size
    assert captured['resolution'] == tier
    assert captured['quality'] == quality
    assert 'aspect_ratio' not in captured
