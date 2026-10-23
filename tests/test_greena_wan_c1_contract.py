from unittest.mock import Mock

import pytest

from src.models import nsfw_new_one


@pytest.mark.parametrize('mode,extra,expected', [
    ('t2v', {}, {}),
    ('i2v', {'img_url': 'https://example.com/first.png'}, {'first_image': 'https://example.com/first.png'}),
    ('first_last_frame', {'img_url': 'https://example.com/first.png', 'last_frame': 'https://example.com/last.png'},
     {'first_image': 'https://example.com/first.png', 'last_image': 'https://example.com/last.png'}),
    ('r2v', {'ref_image_urls': ['https://example.com/ref.png'], 'ref_video_urls': ['https://example.com/ref.mp4'], 'ref_audio_urls': ['https://example.com/ref.mp3']},
     {'reference_images': ['https://example.com/ref.png'], 'reference_videos': ['https://example.com/ref.mp4'], 'reference_audios': ['https://example.com/ref.mp3']}),
])
@pytest.mark.parametrize('duration', [2, 30])
def test_c1_payload_preserves_mode_roles(monkeypatch, tmp_path, mode, extra, expected, duration):
    monkeypatch.setattr(nsfw_new_one, 'gateway_config', lambda _: {'base_url': 'https://example.com/v1', 'api_key': 'test'})
    submitted = Mock(json=lambda: {'id': 'task'})
    post = Mock(return_value=submitted)
    monkeypatch.setattr(nsfw_new_one.requests, 'post', post)
    monkeypatch.setattr(nsfw_new_one.requests, 'get', Mock(return_value=Mock(json=lambda: {'status': 'failed', 'error': 'stop after submit'})))
    with pytest.raises(RuntimeError, match='stop after submit'):
        nsfw_new_one.GreenAVideoModel({}).generate('motion', str(tmp_path / 'video.mp4'), model='nsfw/wan3.0',
            generation_mode=mode, duration=duration, aspect_ratio='adaptive', **extra)
    assert post.call_args.kwargs['json'] == {
        'model': 'wan3.0', 'prompt': 'motion', 'duration': duration, 'resolution': '1080p', 'aspect_ratio': 'adaptive', **expected,
    }


@pytest.mark.parametrize('extra', [
    {'duration': 1}, {'duration': 31}, {'duration': 2.5},
    {'ref_video_urls': ['https://example.com/a.mp4', 'https://example.com/b.mp4']},
    {'ref_audio_urls': ['https://example.com/a.mp3'] * 6},
])
def test_c1_invalid_payload_rejected_before_network(monkeypatch, tmp_path, extra):
    monkeypatch.setattr(nsfw_new_one, 'gateway_config', lambda _: {'base_url': 'https://example.com/v1', 'api_key': 'test'})
    post = Mock()
    monkeypatch.setattr(nsfw_new_one.requests, 'post', post)
    with pytest.raises(ValueError):
        nsfw_new_one.GreenAVideoModel({}).generate('motion', str(tmp_path/'video.mp4'), model='nsfw/wan3.0', **extra)
    post.assert_not_called()
