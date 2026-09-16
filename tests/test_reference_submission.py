from unittest.mock import Mock

import pytest

from src.models import uniart
from src.models.reference_binding import bind_reference_names
from src.apps.playground.models import PlaygroundGeneration
from src.apps.playground.service import PlaygroundService


def capture(monkeypatch):
    post = Mock(return_value={'task_id': 'accepted'})
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', lambda *a, **kw: {})
    monkeypatch.setattr(uniart, '_download_result', lambda *a: None)
    return post


def test_mixed_video_references_follow_canonical_order_and_bind_names(monkeypatch, tmp_path):
    post = capture(monkeypatch)
    refs = ['https://cdn.example/music.wav', 'https://cdn.example/move.mp4', 'https://cdn.example/face.png', 'https://cdn.example/dress.jpg']
    labels = ['music.wav', 'move.mp4', 'Screenshot 2026.png', 'dress.jpg']
    prompt = '让 @Screenshot 2026.png 穿 @dress.jpg，参考 @move.mp4 和 @music.wav'
    gen = PlaygroundGeneration(id='mixed', model_id='uniart/seedance-2.5-special', mode='r2v',
        prompt=prompt, input_media=refs, media_names=dict(zip(refs, labels)),
        parameters={'resolution': '720p', 'duration': 15, 'aspect_ratio': '9:16', 'audio': True}, created_at='today')
    PlaygroundService(Mock(output_dir=str(tmp_path)))._process_video_generation(gen)
    body = post.call_args.args[2]
    assert body['content'][0] == {'type': 'text', 'text': '让 @1 穿 @2，参考 @3 和 @4'}
    assert [part['role'] for part in body['content'][1:]] == ['reference_image', 'reference_image', 'reference_video', 'reference_audio']
    assert [part[part['type']]['url'] for part in body['content'][1:]] == refs[2:] + refs[1:2] + refs[:1]
    assert body['ratio'] == '9:16' and body['generate_audio'] is True
    assert gen.prompt == prompt and gen.input_media == refs


@pytest.mark.parametrize('model,objects', [('gpt-image-2', False), ('gpt-image-2.5-flare-discount', True)])
def test_image_edit_keeps_all_urls_and_names_without_quality_changes(monkeypatch, tmp_path, model, objects):
    post = capture(monkeypatch)
    refs = ['https://cdn.example/a.png', 'https://cdn.example/b.png']
    gen = PlaygroundGeneration(id='images', model_id='uniart/' + model, mode='i2i',
        prompt='@face.png 穿 @dress.png', input_media=refs, media_names=dict(zip(refs, ['face.png', 'dress.png'])),
        parameters={'quality': 'high'}, created_at='today')
    PlaygroundService(Mock(output_dir=str(tmp_path)))._generate_image_mulerouter(gen, 'unused.png', 0)
    body = post.call_args.args[2]
    assert post.call_args.args[1] == '/images/edits'
    assert body['images'] == ([{'image_url': ref} for ref in refs] if objects else refs)
    assert body['prompt'] == '@1 穿 @2'
    assert body['quality'] == 'high'


def test_ambiguous_duplicate_names_are_rejected():
    with pytest.raises(ValueError, match='duplicate names'):
        bind_reference_names('@face.png', ['face.png', 'face.png'])
    assert bind_reference_names('@1 and @2', ['face.png', 'face.png']) == '@1 and @2'


def test_i2v_never_silently_drops_second_image(monkeypatch, tmp_path):
    post = capture(monkeypatch)
    gen = PlaygroundGeneration(id='images', model_id='uniart/minimax-h3-vip', mode='i2v',
        prompt='walk', input_media=['https://cdn.example/a.png', 'https://cdn.example/b.png'],
        parameters={'resolution': '720p'}, created_at='today')
    with pytest.raises(RuntimeError, match='exactly one image'):
        PlaygroundService(Mock(output_dir=str(tmp_path)))._process_video_generation(gen)
    post.assert_not_called()
