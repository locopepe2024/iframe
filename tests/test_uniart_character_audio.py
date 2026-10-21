from pathlib import Path
from unittest.mock import Mock

import pytest

from src.audio.uniart_tts import UniArtTTSProcessor, UniArtTTSError
from src.utils.uniart_catalog import normalize_uniart_model

VOICE = 'uniart:speech-2.8-hd:male-qn-qingse'

@pytest.fixture
def gateway(monkeypatch):
    import src.audio.uniart_tts as module
    config = {'api_key': 'owner-a-key', 'base_url': 'https://gateway.test/v1', 'catalog_name': 'uniart'}
    monkeypatch.setattr(module, 'studio_uniart_config', lambda: dict(config))
    monkeypatch.setattr(module, 'fetch_selected_catalog', lambda config: [
        {'api_model_id': 'speech-2.8-hd', 'capabilities': ['audio']},
    ])
    response = Mock(status_code=200, content=b'ID3audio', headers={'content-type': 'audio/mpeg'})
    transport = Mock(return_value=response)
    monkeypatch.setattr(module.requests, 'post', transport)
    return config, transport


def test_gateway_endpoint_metadata_and_per_call_credentials(gateway, tmp_path):
    config, post = gateway
    processor = UniArtTTSProcessor()
    for owner in ['a', 'b']:
        config['api_key'] = f'owner-{owner}-key'
        processor.synthesize('你好', str(tmp_path / f'{owner}.mp3'), voice=VOICE,
                             speech_rate=1.2, pitch_rate=1, volume=50)
        args = post.call_args
        assert args.args[0] == 'https://gateway.test/v1/audio/speech'
        assert args.kwargs['headers']['Authorization'] == f'Bearer owner-{owner}-key'
        payload = args.kwargs['json']
        assert payload['model'] == 'speech-2.8-hd'
        assert payload['voice'] == 'male-qn-qingse'
        assert payload['input'] == '你好'
        assert payload['metadata']['voice_setting'] == {'speed': 1.2, 'pitch': 0, 'vol': 1.0}
        assert (tmp_path / f'{owner}.mp3').read_bytes() == b'ID3audio'


def test_catalog_uses_endpoint_metadata_and_only_authorized_models(gateway):
    assert normalize_uniart_model({'id': 'speech-2.8-hd', 'supported_endpoint_types': ['audio-speech']})['capabilities'] == ['audio']
    voices = UniArtTTSProcessor().list_voices()
    assert len(voices) == 8
    assert {v['model'] for v in voices} == {'speech-2.8-hd'}
    assert all(v['id'].startswith('uniart:speech-2.8-hd:') for v in voices)


@pytest.mark.parametrize('voice', ['longze_v2', 'Cherry', 'uniart:speech-2.8-turbo:male-qn-qingse', 'uniart:speech-2.8-hd:unknown'])
def test_legacy_and_unavailable_bindings_never_send(gateway, tmp_path, voice):
    _, post = gateway
    with pytest.raises(UniArtTTSError):
        UniArtTTSProcessor().synthesize('你好', str(tmp_path / 'x.mp3'), voice=voice)
    post.assert_not_called()
    assert not (tmp_path / 'x.mp3').exists()


@pytest.mark.parametrize('status,body,content_type', [(401,b'secret upstream error','application/json'),(200,b'','audio/mpeg'),(200,b'{"error":"bad"}','application/json')])
def test_invalid_responses_do_not_replace_good_audio(gateway, tmp_path, status, body, content_type):
    _, post = gateway
    post.return_value = Mock(status_code=status, content=body, headers={'content-type':content_type})
    path = tmp_path / 'x.mp3'
    path.write_bytes(b'old audio')
    with pytest.raises(UniArtTTSError) as error:
        UniArtTTSProcessor().synthesize('你好', str(path), voice=VOICE)
    assert 'secret' not in str(error.value)
    assert path.read_bytes() == b'old audio'


def test_wrong_gateway_and_unknown_instructions_fail_explicitly(gateway, tmp_path):
    config, post = gateway
    with pytest.raises(UniArtTTSError):
        UniArtTTSProcessor().synthesize('你好', str(tmp_path/'x.mp3'), voice=VOICE, instructions='make it magical')
    config['catalog_name'] = 'greena'
    with pytest.raises(UniArtTTSError):
        UniArtTTSProcessor().list_voices()
    post.assert_not_called()


def test_preview_cache_is_owner_scoped_and_checks_current_permissions(gateway, tmp_path):
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user
    config, post = gateway
    processor = UniArtTTSProcessor()
    urls = []
    for owner in ['a', 'b']:
        config['api_key'] = f'owner-{owner}-key'
        token = set_studio_user(UserContext(user_id=owner, owner_profile_id=owner, display_name=owner, access_token=''))
        try:
            first = processor.preview(output_root=str(tmp_path), text='你好', voice=VOICE)
            assert first['cached'] is False
            second = processor.preview(output_root=str(tmp_path), text='你好', voice=VOICE)
            assert second == {**first, 'cached': True}
            urls.append(first['url'])
            assert (tmp_path/first['url']).read_bytes() == b'ID3audio'
            config['catalog_name'] = 'greena'
            with pytest.raises(UniArtTTSError):
                processor.preview(output_root=str(tmp_path), text='你好', voice=VOICE)
            config['catalog_name'] = 'uniart'
        finally:
            reset_studio_user(token)
    assert urls[0] != urls[1]
    assert post.call_count == 2


def test_dialogue_uses_same_gateway_and_reports_legacy_reselection(gateway, tmp_path):
    from src.apps.comic_gen.audio import AudioGenerator
    from src.apps.comic_gen.models import Character, GenerationStatus, StoryboardFrame
    _, post = gateway
    generator = AudioGenerator(output_root=str(tmp_path))
    frame = StoryboardFrame(id='frame', scene_id='scene', owner_profile_id='a', dialogue='你好')
    character = Character(id='char', name='苏砚', description='测试', voice_id=VOICE)
    generator.generate_dialogue(frame, character)
    assert frame.status == GenerationStatus.COMPLETED
    assert (tmp_path/frame.audio_url).read_bytes() == b'ID3audio'
    assert post.call_args.kwargs['json']['model'] == 'speech-2.8-hd'
    character.voice_id = 'longze_v2'
    generator.generate_dialogue(frame, character)
    assert frame.status == GenerationStatus.FAILED
    assert '重新选择' in frame.audio_error
    assert post.call_count == 1


def test_supported_emotion_is_mapped_without_free_text(gateway, tmp_path):
    _, post = gateway
    UniArtTTSProcessor().synthesize('你好', str(tmp_path/'x.mp3'), voice=VOICE, instructions='情绪：高兴')
    assert post.call_args.kwargs['json']['metadata']['voice_setting']['emotion'] == 'happy'


def test_api_preview_uses_owner_cache_and_errors_are_actionable(gateway, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import set_studio_user, reset_studio_user
    monkeypatch.setattr(api, 'pipeline', SimpleNamespace(output_root=str(tmp_path),
                        audio_generator=SimpleNamespace(tts=UniArtTTSProcessor())))
    monkeypatch.setattr(api, 'signed_response', lambda value: value)
    token = set_studio_user(UserContext('a', 'profile-a', 'A', ''))
    try:
        request = api.VoicePreviewRequest(voice_id=VOICE, text='你好')
        assert api.voice_preview(request)['cached'] is False
        assert api.voice_preview(request)['cached'] is True
        with pytest.raises(HTTPException) as failure:
            api.voice_preview(api.VoicePreviewRequest(voice_id='longze_v2', text='你好'))
        assert failure.value.status_code == 422
        assert '重新选择' in failure.value.detail
    finally:
        reset_studio_user(token)


def test_legacy_management_endpoints_do_not_call_direct_provider(monkeypatch):
    from fastapi import HTTPException
    from src.apps.comic_gen import api
    old_provider = Mock()
    monkeypatch.setattr(api, 'pipeline', old_provider)
    for endpoint in [api.voice_clone, api.voice_design_preview, api.voice_design_accept, api.voice_design_translate]:
        with pytest.raises(HTTPException) as failure:
            endpoint(Mock())
        assert failure.value.status_code == 409
    assert old_provider.mock_calls == []


def test_batch_reports_failed_gateway_synthesis_as_failure(monkeypatch):
    from types import SimpleNamespace
    from src.apps.comic_gen import api
    from src.apps.comic_gen.models import Script, Character, StoryboardFrame, GenerationStatus
    frame = StoryboardFrame(id='frame', scene_id='scene', dialogue='你好', character_ids=['char'])
    script = Script(id='project', title='test', original_text='', created_at=1, updated_at=1, characters=[Character(id='char', name='hero', description='', voice_id=VOICE)], frames=[frame])
    def generate(*args):
        frame.status = GenerationStatus.FAILED
        frame.audio_error = 'UniArt synthesis failed'
        return script
    monkeypatch.setattr(api, 'pipeline', SimpleNamespace(get_script=lambda _: script, generate_dialogue_line=generate))
    monkeypatch.setattr(api, 'signed_response', lambda value: value)
    result = api.generate_dialogue_audio_batch('project')
    assert result['_batch_stats']['failed'] == 1
    assert result['_batch_stats']['generated'] == 0


def test_request_context_resolves_correct_owner_without_global_sdk_state(gateway, tmp_path, monkeypatch):
    import src.audio.uniart_tts as module
    import src.apps.studio_access as access
    from src.apps.identity import UserContext
    _, post = gateway
    monkeypatch.setattr(module, 'studio_uniart_config', access.studio_uniart_config)
    monkeypatch.setattr(access, 'runtime_uniart_for_owner', lambda user_id, profile_id: {
        'api_key': f'{user_id}-{profile_id}', 'base_url': 'https://gateway.test/v1', 'catalog_name': 'uniart'})
    monkeypatch.setenv('DASHSCOPE_API_KEY', 'unused-shared-key')
    processor = module.UniArtTTSProcessor()
    for owner in ['a', 'b']:
        token = access.set_studio_user(UserContext(owner, f'profile-{owner}', owner, ''))
        try:
            processor.synthesize('你好', str(tmp_path/f'{owner}.mp3'), voice=VOICE)
        finally:
            access.reset_studio_user(token)
        assert post.call_args.kwargs['headers']['Authorization'] == f'Bearer {owner}-profile-{owner}'


def test_voice_http_routes_require_and_propagate_owner_context(monkeypatch):
    from fastapi import HTTPException
    from fastapi.testclient import TestClient
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    from src.apps.studio_access import require_studio_user

    def resolve(authorization, _cookie, _key_header):
        if authorization not in {"Bearer owner-test", "Bearer other-test"}:
            raise HTTPException(status_code=401, detail="Authentication required")
        other = authorization == "Bearer other-test"
        return UserContext("other-test" if other else "owner-test",
                           "other-profile" if other else "profile-test", "Test", ""), False

    monkeypatch.setattr(api, "_resolve_request_context", resolve)
    monkeypatch.setattr(api.pipeline.audio_generator, "get_available_voices",
                        lambda: [{"id": require_studio_user().owner_profile_id}])
    monkeypatch.setattr(api.pipeline.audio_generator.tts, "preview",
                        lambda **_kwargs: {"url": require_studio_user().owner_profile_id, "cached": False})
    monkeypatch.setattr(api, "signed_response", lambda value: value)
    client = TestClient(api.app, raise_server_exceptions=False)

    assert client.get("/voices").status_code == 401
    assert client.post("/voice/preview", json={"voice_id": VOICE, "text": "你好"}).status_code == 401
    headers = {"Authorization": "Bearer owner-test"}
    voices = client.get("/voices", headers=headers)
    assert voices.status_code == 200
    assert voices.json() == [{"id": "profile-test"}]
    preview = client.post("/voice/preview", headers=headers, json={"voice_id": VOICE, "text": "你好"})
    assert preview.status_code == 200
    assert preview.json() == {"url": "profile-test", "cached": False}
    other = client.get("/voices", headers={"Authorization": "Bearer other-test"})
    assert other.status_code == 200
    assert other.json() == [{"id": "other-profile"}]
