from unittest.mock import Mock
import pytest
from src.models import uniart


@pytest.mark.parametrize('mode,media,expected,roles', [
    ('text2video', {}, 'text_to_video', []),
    ('image2video', {'img_url': 'https://cdn.test/first.png'}, 'image2video', ['first_frame']),
    ('reference2video', {'ref_image_urls': ['https://cdn.test/a.png'], 'ref_video_urls': ['https://cdn.test/m.mp4'], 'ref_audio_urls': ['https://cdn.test/a.wav']}, 'omni_reference', ['reference_image', 'reference_video', 'reference_audio']),
    ('frames2video', {'first_frame': 'https://cdn.test/first.png', 'last_frame': 'https://cdn.test/last.png'}, 'first_last_frame', ['first_frame', 'last_frame']),
])
def test_h3_v2_modes_use_dedicated_create_and_query(monkeypatch, tmp_path, mode, media, expected, roles):
    post = Mock(return_value={'id': 'accepted'})
    poll = Mock(return_value={})
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_download_result', Mock())
    uniart.UniArtVideoModel({'base_url': 'https://gateway.test/v1', 'api_key': 'test'}).generate(
        '<Picture 1> animate' if roles else 'animate', str(tmp_path / 'v.mp4'),
        model='minimax-h3-discount', h3_api_version='v2', mode=mode, duration=4, resolution='720p', aspect_ratio='16:9', **media)
    config, path, body = post.call_args.args
    assert config['base_url'] + path == 'https://gateway.test/oran/h3/v2/videos'
    assert body['model'] == 'minimax-h3-discount'
    assert body['mode'] == expected
    assert [c['role'] for c in body['content'][1:]] == roles
    assert body['ratio'] == ('adaptive' if 'first_frame' in roles else '16:9')
    assert set(body) == {'model', 'mode', 'content', 'duration', 'resolution', 'ratio'}
    assert poll.call_args.args[0]['base_url'] == 'https://gateway.test/oran/h3/v2'


@pytest.mark.parametrize('params', [{'seed': 0}, {'generate_audio': False}, {'watermark': True}, {'duration': 3}, {'duration': 4.5}, {'resolution': '1080p'}])
def test_h3_v2_rejects_unsupported_parameters_before_submission(monkeypatch, tmp_path, params):
    post = Mock()
    monkeypatch.setattr(uniart, '_post', post)
    with pytest.raises(ValueError):
        uniart.UniArtVideoModel({}).generate('animate', str(tmp_path / 'v.mp4'), model='minimax-h3-discount', h3_api_version='v2', **({'duration': 4, 'resolution': '720p'} | params))
    post.assert_not_called()


@pytest.mark.parametrize('version,base', [('v2', 'https://gateway.test/oran/h3/v2'), ('v1', 'https://gateway.test/v1')])
def test_resume_uses_saved_api_version_without_submission(monkeypatch, tmp_path, version, base):
    post = Mock()
    poll = Mock(return_value={})
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_download_result', Mock())
    uniart.UniArtVideoModel({'base_url': 'https://gateway.test/v1'}).generate(
        '', str(tmp_path / 'v.mp4'), model='minimax-h3-discount', resume_task_id='accepted', h3_api_version=version)
    assert poll.call_args.args[0]['base_url'] == base
    post.assert_not_called()


@pytest.mark.parametrize('mode,expected,roles', [
    ('t2v', 'text_to_video', []), ('i2v', 'image2video', ['first_frame']),
    ('r2v', 'omni_reference', ['reference_image', 'reference_image']),
    ('f2v', 'first_last_frame', ['first_frame', 'last_frame']),
])
def test_playground_h3_v2_modes_and_version_persistence(monkeypatch, tmp_path, mode, expected, roles):
    from src.apps.playground.models import PlaygroundGeneration
    from src.apps.playground.service import PlaygroundService
    refs = ['https://cdn.test/a.png', 'https://cdn.test/b.png'][:len(roles)]
    gen = PlaygroundGeneration(id='v2', model_id='uniart/minimax-h3-discount', mode=mode,
        prompt='<Picture 1> move @1' if refs else 'move', input_media=refs,
        parameters={'duration': 4, 'resolution': '720p'}, created_at='today')
    post = Mock(return_value={'id': 'accepted'})
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', Mock(return_value={}))
    monkeypatch.setattr(uniart, '_download_result', Mock())
    PlaygroundService(Mock(output_dir=str(tmp_path)))._generate_video_mulerouter(gen, str(tmp_path / 'v.mp4'))
    body = post.call_args.args[2]
    assert body['mode'] == expected
    assert [c['role'] for c in body['content'][1:]] == roles
    assert gen.provider_tasks == {'0': 'accepted'}
    assert gen.provider_task_api_versions == {'0': 'v2'}
    assert '@' not in body['content'][0]['text']


@pytest.mark.parametrize('versions,expected', [({}, 'v1'), ({'0': 'v2'}, 'v2')])
def test_playground_resume_passes_persisted_version_without_loading_materials(monkeypatch, tmp_path, versions, expected):
    from src.apps.playground.models import PlaygroundGeneration
    from src.apps.playground.service import PlaygroundService
    generate = Mock()
    monkeypatch.setattr(uniart.UniArtVideoModel, 'generate', generate)
    gen = PlaygroundGeneration(id='saved', model_id='uniart/minimax-h3-discount', mode='i2v', prompt='move',
        input_media=['missing.png'], provider_tasks={'0': 'saved-task'}, provider_task_api_versions=versions, created_at='today')
    service = PlaygroundService(Mock(output_dir=str(tmp_path)))
    service._resolve_first_input_media = Mock(side_effect=AssertionError('must not read attachments'))
    service._generate_video_mulerouter(gen, str(tmp_path / 'v.mp4'))
    assert generate.call_args.kwargs['h3_api_version'] == expected


def test_v2_acceptance_survives_restart_and_resumes_without_material_access(monkeypatch, tmp_path):
    from src.apps.playground.models import PlaygroundGeneration
    from src.apps.playground.service import PlaygroundService
    from src.apps.playground.storage import PlaygroundStorage
    monkeypatch.chdir(tmp_path)
    storage = PlaygroundStorage(owner_user_id='user', owner_profile_id='profile')
    gen = PlaygroundGeneration(id='restart-v2', model_id='uniart/minimax-h3-discount', mode='r2v', prompt='move',
        input_media=['https://cdn.test/a.png'], parameters={'duration': 4, 'resolution': '720p'},
        owner_user_id='user', owner_profile_id='profile', created_at='today')
    storage.add_generation(gen)
    monkeypatch.setattr(uniart, '_post', Mock(return_value={'id': 'saved-v2'}))
    monkeypatch.setattr(uniart, '_poll', Mock(side_effect=SystemExit('restart')))
    with pytest.raises(SystemExit):
        PlaygroundService(storage)._generate_video_mulerouter(gen, str(tmp_path / 'v.mp4'))
    reloaded = PlaygroundStorage(owner_user_id='user', owner_profile_id='profile')
    saved = reloaded.get_generation(gen.id)
    assert saved.provider_task_api_versions == {'0': 'v2'}
    assert saved.provider_tasks == {'0': 'saved-v2'}
    post = Mock(side_effect=AssertionError('must not resubmit'))
    poll = Mock(return_value={})
    monkeypatch.setattr(uniart, '_post', post)
    monkeypatch.setattr(uniart, '_poll', poll)
    monkeypatch.setattr(uniart, '_media', Mock(side_effect=AssertionError('must not upload')))
    monkeypatch.setattr(uniart, '_download_result', Mock())
    PlaygroundService(reloaded)._generate_video_mulerouter(saved, str(tmp_path / 'v.mp4'))
    assert poll.call_args.args[0]['base_url'].endswith('/oran/h3/v2')
    post.assert_not_called()


def test_v2_create_failure_never_retries_v1_or_changes_sku(monkeypatch, tmp_path):
    post = Mock(side_effect=RuntimeError('no V2 candidate'))
    monkeypatch.setattr(uniart, '_post', post)
    with pytest.raises(RuntimeError, match='no V2 candidate'):
        uniart.UniArtVideoModel({}).generate('move', str(tmp_path / 'v.mp4'),
            model='minimax-h3-vip', h3_api_version='v2', duration=4, resolution='720p')
    assert post.call_count == 1
    assert post.call_args.args[0]['base_url'].endswith('/oran/h3/v2')
    assert post.call_args.args[2]['model'] == 'minimax-h3-vip'


@pytest.mark.parametrize('media', [
    {'ref_image_urls': ['https://cdn.test/a.png'] * 10},
    {'ref_video_urls': ['https://cdn.test/a.mp4'] * 4},
    {'ref_audio_urls': ['https://cdn.test/a.wav'] * 4},
    {'first_frame': 'https://cdn.test/a.png', 'last_frame': 'https://cdn.test/b.png', 'ref_image_urls': ['https://cdn.test/c.png']},
])
def test_v2_rejects_excessive_or_mixed_frame_references(monkeypatch, tmp_path, media):
    post = Mock()
    monkeypatch.setattr(uniart, '_post', post)
    with pytest.raises(ValueError):
        uniart.UniArtVideoModel({}).generate('move', str(tmp_path / 'v.mp4'),
            model='minimax-h3-discount', h3_api_version='v2', duration=4, resolution='720p', **media)
    post.assert_not_called()
