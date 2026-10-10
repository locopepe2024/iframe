from unittest.mock import Mock
from io import BytesIO

import pytest
import httpx
from openai import APIStatusError, APITimeoutError
from fastapi import HTTPException, UploadFile
from src.apps import agent_api as agent
from src.apps.identity import UserContext


def test_asr_requires_catalog_access_and_valid_audio(setup, monkeypatch):
    monkeypatch.setattr(agent, 'asr_available', lambda ctx: False)
    with pytest.raises(HTTPException, match='尚未开放'):
        agent.transcribe_audio(UploadFile(file=BytesIO(b'voice'), filename='voice.wav'), setup)
    monkeypatch.setattr(agent, 'asr_available', lambda ctx: True)
    with pytest.raises(HTTPException, match='格式不支持'):
        agent.transcribe_audio(UploadFile(file=BytesIO(b'voice'), filename='voice.webm'), setup)


def test_asr_returns_draft_without_creating_chat_message(setup, monkeypatch):
    monkeypatch.setattr(agent, 'asr_available', lambda ctx: True)
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={
        'api_key': 'test', 'base_url': 'https://example.test/v1',
    })))
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            self.audio = Mock(transcriptions=Mock(create=self.create))

        def create(self, **kwargs):
            captured.update(kwargs)
            return Mock(text=' 明天下午去公园 ')

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    import openai
    monkeypatch.setattr(openai, 'OpenAI', Client)
    result = agent.transcribe_audio(UploadFile(file=BytesIO(b'voice'), filename='voice.wav', headers={'content-type': 'audio/wav'}), setup)
    assert result == {'text': '明天下午去公园', 'model': 'asr-1.0'}
    assert captured['model'] == 'asr-1.0'
    assert captured['file'][0] == 'voice.wav'
    with agent.database() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 0


@pytest.mark.parametrize('status,expected', [(502, '对话网关返回'), (401, '鉴权'), (429, '请求受限'), (400, '拒绝对话请求')])
def test_provider_failures_are_distinguished_and_release_session(setup, monkeypatch, status, expected):
    ctx = setup
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    response = httpx.Response(status, request=httpx.Request('POST', 'https://example.com/chat'))
    error = APIStatusError('sensitive-provider-body', response=response, body=None)
    monkeypatch.setattr(agent, 'complete', Mock(side_effect=error))
    with pytest.raises(HTTPException) as caught:
        agent.send(sid, agent.MessageCreate(content='draft'), ctx)
    assert expected in caught.value.detail
    assert f'HTTP {status}' in caught.value.detail
    assert 'sensitive-provider-body' not in caught.value.detail
    with agent.database() as db:
        row, session = agent.read_session(db, ctx.owner_profile_id, sid)
    assert row['busy'] == 0
    assert session['messages'] == []


def test_provider_timeout_is_not_reported_as_bad_credentials(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    monkeypatch.setattr(agent, 'complete', Mock(side_effect=APITimeoutError(request=httpx.Request('POST', 'https://example.com/chat'))))
    with pytest.raises(HTTPException, match='响应超时'):
        agent.send(sid, agent.MessageCreate(content='draft'), setup)


def test_chat_timeout_and_busy_lease_cover_slow_upstream(setup, monkeypatch):
    monkeypatch.setenv('IFRAME_AGENT_CHAT_TIMEOUT_SECONDS', '600')
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={
        'api_key': 'test', 'base_url': 'https://example.test/v1',
    })))
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen', 'capabilities': ['chat']}])
    observed = {}

    class Client:
        def __init__(self, **kwargs):
            observed['timeout'] = kwargs['timeout']
            self.chat = Mock(completions=Mock(create=Mock(return_value=Mock(
                model_dump=Mock(return_value={'choices': [{'message': {'content': 'ok'}}]}),
            ))))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    import openai
    monkeypatch.setattr(openai, 'OpenAI', Client)
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    original_complete = agent.complete

    def inspect_lease(ctx, model, history):
        with agent.database() as db:
            row, _ = agent.read_session(db, setup.owner_profile_id, sid)
        observed['lease_remaining'] = row['busy'] - agent.time.time()
        return original_complete(ctx, model, history)

    monkeypatch.setattr(agent, 'complete', inspect_lease)
    agent.send(sid, agent.MessageCreate(content='slow request'), setup)

    assert observed['timeout'] == 600
    assert observed['lease_remaining'] > 650


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.sqlite3'))
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen', 'capabilities': ['chat']}])
    return UserContext('user', 'profile', 'name', 'token')


def test_multiturn_owner_and_model(setup, monkeypatch):
    ctx = setup
    session = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']
    sid = session['id']
    call = Mock(return_value='优化后的提示词')
    monkeypatch.setattr(agent, 'complete', call)
    agent.send(sid, agent.MessageCreate(content='一个女孩', asset_names=['参考.png'], context='草稿'), ctx)
    agent.send(sid, agent.MessageCreate(content='加一只小狗'), ctx)
    history = call.call_args.args[2]
    assert len(history) == 4
    assert '参考.png' in history[1]['content']
    assert history[2]['content'] == '优化后的提示词'
    assert len(agent.messages(sid, ctx)['messages']) == 4
    other = UserContext('other', 'other-profile', 'other', 'other-token')
    for fn in [lambda: agent.messages(sid, other), lambda: agent.delete(sid, other), lambda: agent.patch(sid, agent.SessionPatch(title='x'), other)]:
        with pytest.raises(HTTPException) as exc:
            fn()
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException):
        agent.create(agent.SessionCreate(model='image-only'), ctx)
    agent.patch(sid, agent.SessionPatch(title='新的标题'), ctx)
    assert agent.sessions(ctx)['sessions'][0]['title'] == '新的标题'
    agent.delete(sid, ctx)
    assert agent.sessions(ctx)['sessions'] == []


def test_knowledge_search_uses_authenticated_owner_and_persists_citations(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    calls = []
    citation = {
        'unit_id': 'unit-a', 'revision_id': 'revision-a', 'source_id': 'source-a',
        'collection_id': 'collection-a', 'scope': 'owner', 'kind': 'text',
        'locator': 'section:policy', 'title': 'Printing report',
        'source_uri': 'upload:report', 'rights_status': 'owned',
        'has_media': False, 'excerpt': 'Printing policy', 'annotation': '',
    }
    monkeypatch.setattr(agent, 'search_knowledge', lambda owner, query: calls.append((owner, query)) or [citation])
    completion = Mock(return_value='政策摘要 [unit-a]')
    monkeypatch.setattr(agent, 'complete', completion)

    agent.send(sid, agent.MessageCreate(content='分析印刷行业政策', knowledge_search=True,
                                       knowledge_query='印刷政策'), setup)
    assert calls == [(setup.owner_profile_id, '印刷政策')]
    history = completion.call_args.args[2]
    assert '未经核实' in history[0]['content']
    assert 'unit-a' in history[1]['content']
    assert agent.messages(sid, setup)['messages'][-1]['knowledge_citations'] == [citation]

    agent.send(sid, agent.MessageCreate(content='继续'), setup)
    assert len(calls) == 1
    assert '知识库检索结果' not in completion.call_args.args[2][0]['content']


def test_knowledge_search_failure_and_unsupported_modes_do_not_save_turn(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    monkeypatch.setattr(agent, 'search_knowledge', Mock(side_effect=HTTPException(503, '知识库检索暂不可用')))
    with pytest.raises(HTTPException) as error:
        agent.send(sid, agent.MessageCreate(content='查询政策', knowledge_search=True), setup)
    assert error.value.status_code == 503
    assert agent.messages(sid, setup)['messages'] == []
    with agent.database() as db:
        row, _ = agent.read_session(db, setup.owner_profile_id, sid)
        assert row['busy'] == 0
    with pytest.raises(HTTPException) as error:
        agent.send(sid, agent.MessageCreate(content='查询政策', knowledge_search=True,
                                            companion_skills=['memory']), setup)
    assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        agent.send(sid, agent.MessageCreate(content='查询政策', knowledge_query='政策'), setup)
    assert error.value.status_code == 422


def test_companion_skills_are_server_owned_and_not_persisted_as_user_memory(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    complete = Mock(return_value='我听着呢。')
    monkeypatch.setattr(agent, 'complete', complete)
    agent.send(sid, agent.MessageCreate(content='今天有点孤单', companion_skills=['listening', 'memory']), setup)
    system = complete.call_args.args[2][0]['content']
    assert agent.COMPANION_SKILL_INSTRUCTIONS['listening'] in system
    assert agent.COMPANION_SKILL_INSTRUCTIONS['memory'] in system
    assert 'companion_skills' not in agent.messages(sid, setup)['messages'][0]
    with pytest.raises(HTTPException) as invalid:
        agent.send(sid, agent.MessageCreate(content='你好', companion_skills=['unknown']), setup)
    assert invalid.value.status_code == 422
    with pytest.raises(HTTPException) as duplicate:
        agent.send(sid, agent.MessageCreate(content='你好', companion_skills=['memory', 'memory']), setup)
    assert duplicate.value.status_code == 422


def test_confirmed_memory_is_owner_scoped_and_injected_only_when_enabled(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    completion = Mock(return_value='好的')
    monkeypatch.setattr(agent, 'complete', completion)
    agent.send(sid, agent.MessageCreate(content='我喜欢听邓丽君的歌', companion_skills=[]), setup)
    message = agent.messages(sid, setup)['messages'][0]
    saved = agent.create_memory(agent.MemoryCreate(content='喜欢听邓丽君的歌', category='preference', source_session_id=sid, source_message_id=message['id'], source_quote='我喜欢听邓丽君的歌'), setup)
    assert saved['memory']['owner'] == setup.owner_profile_id
    next_sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    agent.send(next_sid, agent.MessageCreate(content='你还记得我喜欢什么吗？', companion_skills=['memory']), setup)
    assert '喜欢听邓丽君的歌' in completion.call_args.args[2][0]['content']
    agent.send(next_sid, agent.MessageCreate(content='继续', companion_skills=[]), setup)
    assert '已确认的跨会话记忆' not in completion.call_args.args[2][0]['content']
    other = UserContext('other', 'other-profile', 'other', 'token')
    assert agent.memories(other)['memories'] == []
    with pytest.raises(HTTPException):
        agent.create_memory(agent.MemoryCreate(content='假记忆', source_session_id=sid, source_message_id=message['id'], source_quote='不存在的原文'), setup)
    agent.delete_memory(saved['memory']['id'], setup)
    assert agent.memories(setup)['memories'] == []


def test_memory_candidate_requires_confirmation_and_source_deletion_removes_memory(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    monkeypatch.setattr(agent, 'complete', Mock(return_value='好呀'))
    agent.send(sid, agent.MessageCreate(content='我喜欢下棋'), setup)
    candidate = agent.extract_memories(setup)['candidates'][0]
    assert candidate['content'] == '我喜欢下棋'
    assert agent.memories(setup)['memories'] == []
    saved = agent.create_memory(agent.MemoryCreate(**candidate), setup)['memory']
    agent.patch_memory(saved['id'], agent.MemoryPatch(content='喜欢象棋'), setup)
    assert agent.memories(setup)['memories'][0]['content'] == '喜欢象棋'
    agent.delete_message(sid, candidate['source_message_id'], setup)
    assert agent.memories(setup)['memories'] == []


def test_failed_turn_unlocks_and_busy_rejected(setup, monkeypatch):
    ctx = setup
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    monkeypatch.setattr(agent, 'complete', Mock(side_effect=ValueError('secret must not leak')))
    with pytest.raises(HTTPException) as exc:
        agent.send(sid, agent.MessageCreate(content='你好'), ctx)
    assert exc.value.status_code == 502
    assert 'secret' not in exc.value.detail
    assert agent.messages(sid, ctx)['messages'] == []
    with agent.database() as db:
        row, _ = agent.read_session(db, ctx.owner_profile_id, sid)
        assert row['busy'] == 0
        db.execute('UPDATE sessions SET busy=?', (agent.time.time() + 180,))
    with pytest.raises(HTTPException) as exc:
        agent.send(sid, agent.MessageCreate(content='再次发送'), ctx)
    assert exc.value.status_code == 409


def test_linked_conversation_and_image_context(setup, monkeypatch):
    ctx = setup
    monkeypatch.setattr(agent, 'require_playground', lambda ctx, sid: None)
    first = agent.create(agent.SessionCreate(model='qwen', playground_session_id='canvas'), ctx)['session']
    second = agent.create(agent.SessionCreate(model='qwen', playground_session_id='canvas'), ctx)['session']
    assert first['id'] == second['id']
    monkeypatch.setattr(agent, 'reference_content', lambda ctx, ref: {'type': 'image_url', 'image_url': {'url': 'https://media.example/image.png'}})
    complete = Mock(return_value='看见一只小狗')
    monkeypatch.setattr(agent, 'complete', complete)
    agent.send(first['id'], agent.MessageCreate(content='这是什么？', input_media=['/playground/input-media/a.png']), ctx)
    assert complete.call_args.args[2][-1]['content'][2] == {
        'type': 'image_url', 'image_url': {'url': 'https://media.example/image.png'}}
    agent.send(first['id'], agent.MessageCreate(content='它的颜色？'), ctx)
    assert complete.call_args.args[2][1]['content'][2]['type'] == 'image_url'
    assert isinstance(complete.call_args.args[2][2]['content'], str)
    assert len(agent.playground_conversation('canvas', ctx)['messages']) == 4


def test_delete_message_is_persistent_and_owner_scoped(setup, monkeypatch):
    ctx = setup
    monkeypatch.setattr(agent, 'complete', Mock(return_value='建议'))
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    result = agent.send(sid, agent.MessageCreate(content='你好'), ctx)
    user = result['user_message']
    reply = result['assistant_message']
    assert user['created_at'] <= reply['created_at']
    assert reply['model'] == 'qwen'
    other = UserContext('other', 'other', 'other', 'token')
    with pytest.raises(HTTPException):
        agent.delete_message(sid, reply['id'], other)
    agent.delete_message(sid, reply['id'], ctx)
    assert agent.messages(sid, ctx)['messages'] == [user]


def test_agent_catalog_exact_models_and_order(monkeypatch):
    import io
    models = ['glm-5.3-flash', 'deepseek-v4.1-flash', 'glm-5.3', 'gpt-5.6-luna-2026-07-09', 'qwen3.8-flash', 'gpt-5.6-sol', 'gpt-5.6-luna', 'chatgpt-6']
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={'base_url': 'https://example.test/v1', 'api_key': 'test'})))
    monkeypatch.setattr(agent, 'urlopen', lambda *a, **kw: io.StringIO(agent.json.dumps({'data': [{'id': m} for m in models]})))
    result = agent.catalog(UserContext('a','a','a','token'))
    assert [m['api_model_id'] for m in result] == ['gpt-5.6-sol', 'gpt-5.6-luna', 'qwen3.8-flash', 'glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash']
    assert result[0]['display_name'] == 'GPT 5.6 Sol'


def test_linked_status_tracks_lease_and_releases_on_failure(setup, monkeypatch):
    monkeypatch.setattr(agent, 'require_playground', lambda ctx, sid: None)
    sid = agent.create(agent.SessionCreate(model='qwen', playground_session_id='status'), setup)['session']['id']
    def fail(*args):
        assert agent.playground_conversation('status', setup)['busy_until'] > agent.time.time()
        raise ValueError('upstream failure')
    monkeypatch.setattr(agent, 'complete', fail)
    with pytest.raises(HTTPException):
        agent.send(sid, agent.MessageCreate(content='hello'), setup)
    assert agent.playground_conversation('status', setup)['busy_until'] == 0


def test_audio_and_text_payloads(setup, tmp_path, monkeypatch):
    audio = tmp_path / 'reference.wav'
    audio.write_bytes(b'RIFFtest')
    monkeypatch.setattr(agent, 'reference_path', lambda ctx, ref: str(audio))
    result = agent.reference_content(setup, 'owner-scoped-reference')
    assert result['type'] == 'input_audio'
    assert agent.base64.b64decode(result['input_audio']['data']) == b'RIFFtest'
    text = tmp_path / 'script.md'
    text.write_text('分镜：小狗跳舞', encoding='utf-8')
    monkeypatch.setattr(agent, 'reference_path', lambda ctx, ref: str(text))
    assert '分镜：小狗跳舞' in agent.reference_content(setup, 'reference')['text']


def test_agent_accepts_owned_library_path_and_validates_signed_studio_reference(setup, tmp_path, monkeypatch):
    from src.apps.studio_access import studio_media_url, studio_owner_dir

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-signing-key')
    image = agent.os.path.join(studio_owner_dir(setup.owner_profile_id), 'assets', 'character.png')
    agent.os.makedirs(agent.os.path.dirname(image), exist_ok=True)
    with open(image, 'wb') as file:
        file.write(b'image')
    stored = agent.os.path.relpath(image, 'output')

    assert agent.reference_path(setup, stored) == agent.os.path.realpath(image)
    signed = studio_media_url(setup.owner_profile_id, stored)
    assert agent.reference_path(setup, signed) == agent.os.path.realpath(image)
    with pytest.raises(HTTPException, match='参考素材不存在'):
        agent.reference_path(setup, signed.replace('signature=', 'signature=wrong'))

    foreign = agent.os.path.join(studio_owner_dir('foreign-profile'), 'assets', 'other.png')
    agent.os.makedirs(agent.os.path.dirname(foreign), exist_ok=True)
    with open(foreign, 'wb') as file:
        file.write(b'other image')
    with pytest.raises(HTTPException, match='参考素材不存在'):
        agent.reference_path(setup, agent.os.path.relpath(foreign, 'output'))


def test_agent_accepts_absolute_managed_media_url(setup, tmp_path, monkeypatch):
    from src.apps.playground import api as playground_api

    monkeypatch.chdir(tmp_path)
    upload = tmp_path / 'output' / 'users' / 'owner' / 'playground' / 'uploads' / 'edited.png'
    upload.parent.mkdir(parents=True)
    upload.write_bytes(b'image')
    storage = Mock(output_dir=str(upload.parent.parent.parent), resolve_media_reference=lambda value: str(upload))
    monkeypatch.setattr(playground_api, '_storage_for', lambda ctx: storage)

    assert agent.reference_path(setup, 'https://garage.uniart.fun/playground/input-media/edited.png') == str(upload.resolve())


def test_agent_resolves_only_owned_library_object_keys(setup, monkeypatch):
    from types import SimpleNamespace
    from src.apps.comic_gen import api as studio_api
    from src.models import uniart

    owned = 'lumenx/assets/owned-character.png'
    foreign = 'lumenx/assets/foreign-character.png'
    index = SimpleNamespace(assets=[SimpleNamespace(variants=[SimpleNamespace(storage_key=owned)])])
    lookup = Mock(return_value=index)
    monkeypatch.setattr(studio_api.pipeline, 'get_asset_library_reference_index', lookup)
    sign = Mock(return_value='https://media.example/owned-character.png?fresh=1')
    monkeypatch.setattr(uniart, '_image_reference_url', sign)

    assert agent.reference_content(setup, owned)['image_url']['url'] == sign.return_value
    assert agent.reference_content(setup, 'https://old.example/' + owned + '?expired=1')['image_url']['url'] == sign.return_value
    assert lookup.call_args.args == (setup.owner_profile_id,)
    assert sign.call_args.args == (owned,)
    with pytest.raises(HTTPException):
        agent.reference_content(setup, foreign)


def test_agent_resolves_owned_library_local_variant_path(setup, tmp_path, monkeypatch):
    """Library references may be local paths when managed object storage is off."""
    from types import SimpleNamespace
    from src.apps.comic_gen import api as studio_api
    from src.models import uniart

    monkeypatch.chdir(tmp_path)
    local_path = 'output/users/owner/studio/assets/character.png'
    image = tmp_path / local_path
    image.parent.mkdir(parents=True)
    image.write_bytes(b'image')
    index = SimpleNamespace(assets=[SimpleNamespace(variants=[SimpleNamespace(storage_key=local_path)])])
    monkeypatch.setattr(studio_api.pipeline, 'get_asset_library_reference_index', Mock(return_value=index))
    monkeypatch.setattr(uniart, '_image_reference_url', lambda value: 'https://media.example/character.png')

    result = agent.reference_content(setup, local_path)

    assert result == {'type': 'image_url', 'image_url': {'url': 'https://media.example/character.png'}}


def test_agent_resolves_signed_studio_asset_url_to_owned_storage_key(setup, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from src.apps.comic_gen import api as studio_api
    from src.apps.studio_access import studio_media_url, studio_owner_key
    from src.models import uniart

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LUMENX_MEDIA_SIGNING_KEY", "test-media-signing-key")
    owner_key = studio_owner_key(setup.owner_profile_id)
    storage_key = f"users/{owner_key}/studio/assets/character.png"
    image = tmp_path / "output" / storage_key
    image.parent.mkdir(parents=True)
    image.write_bytes(b"image")
    reference = studio_media_url(setup.owner_profile_id, storage_key)
    index = SimpleNamespace(assets=[SimpleNamespace(variants=[SimpleNamespace(storage_key=storage_key)])])
    monkeypatch.setattr(studio_api.pipeline, 'get_asset_library_reference_index', Mock(return_value=index))
    monkeypatch.setattr(uniart, '_image_reference_url', lambda value: f"https://media.example/{value}")

    result = agent.reference_content(setup, reference)

    assert result['image_url']['url'] == f"https://media.example/{storage_key}"


def test_image_variant_promotes_legacy_url_to_storage_key():
    from src.apps.comic_gen.models import ImageVariant

    variant = ImageVariant(id='v1', url='output/assets/character.png')

    assert variant.storage_key == 'output/assets/character.png'
    variant.url = 'lumenx/assets/character.png'
    assert variant.storage_key == 'lumenx/assets/character.png'
    variant.url = 'https://cdn.example/character.png'
    assert variant.storage_key == 'lumenx/assets/character.png'


def test_chat_mixed_materials_and_names_survive_followup(setup, tmp_path, monkeypatch):
    from src.models import uniart
    files = []
    for name in ['face.png', 'dress.jpg', 'walk.mp4', 'sound.wav', 'script.txt']:
        path = tmp_path / name
        path.write_bytes(b'sample')
        files.append(str(path))
    monkeypatch.setattr(agent, 'reference_path', lambda ctx, ref: ref)
    monkeypatch.setattr(uniart, '_image_reference_url', lambda path: 'https://cdn.example/' + path.split('/')[-1])
    call = Mock(return_value='answer')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    agent.send(sid, agent.MessageCreate(content='Use @face.png with @walk.mp4', input_media=files,
        asset_names=['face.png', 'dress.jpg', 'walk.mp4', 'sound.wav', 'script.txt']), setup)
    parts = call.call_args.args[2][-1]['content']
    assert parts[0]['text'].startswith('Use @1 with @3')
    assert [parts[i]['type'] for i in [2, 4, 6, 8, 10]] == ['image_url', 'image_url', 'video_url', 'input_audio', 'text']
    assert parts[2]['image_url']['url'] == 'https://cdn.example/face.png'
    assert parts[6]['video_url'] == 'https://cdn.example/walk.mp4'
    assert '参考素材 @4：sound.wav' in parts[7]['text']
    agent.send(sid, agent.MessageCreate(content='Continue'), setup)
    assert call.call_args.args[2][1]['content'] == parts


def test_h3_agent_restores_original_filenames_in_optimized_prompt(setup, monkeypatch):
    call = Mock(return_value='请让 @1、2 在镜头中唱歌，并保持 @3 的外观')
    monkeypatch.setattr(agent, 'complete', call)
    monkeypatch.setattr(agent, 'reference_content', lambda ctx, ref: {'type': 'image_url', 'image_url': {'url': ref}})
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    agent.send(
        sid,
        agent.MessageCreate(
            content='请优化为 H3：让 @Weixin Image_20260922133813_485_51.jpg 在唱歌',
            input_media=['/tmp/weixin.jpg', '/tmp/character.png', '/tmp/song.mp4'],
            asset_names=['Weixin Image_20260922133813_485_51.jpg', 'character.png', 'song.mp4'],
        ),
        setup,
    )
    assistant = agent.messages(sid, setup)['messages'][-1]
    assert assistant['content'] == '请让 @Weixin Image_20260922133813_485_51.jpg、@character.png 在镜头中唱歌，并保持 @song.mp4 的外观'


def test_h3_restore_uses_answer_marker_when_followup_does_not_repeat_model(setup, monkeypatch):
    call = Mock(return_value='以下是优化后的 H3 提示词：@1 在湖边唱歌')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    agent.send(sid, agent.MessageCreate(content='先用 H3 优化 @lake.jpg', asset_names=['lake.jpg']), setup)
    agent.send(sid, agent.MessageCreate(content='继续', asset_names=[]), setup)
    assistant = agent.messages(sid, setup)['messages'][-1]
    assert '@lake.jpg' in assistant['content']


def test_followup_without_materials_does_not_revalidate_historical_duplicate_names(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    monkeypatch.setattr(agent, 'reference_content', lambda ctx, ref: {'type': 'image_url', 'image_url': {'url': ref}})
    # Simulate a legacy turn that was persisted before the filename gate was
    # introduced. A follow-up without materials must still be sendable.
    with agent.database() as db:
        row, session = agent.read_session(db, setup.owner_profile_id, sid)
        session['messages'] = [{
            'id': 'legacy-user', 'role': 'user', 'content': '旧素材',
            'asset_names': ['same.png', 'same.png'],
            'input_media': ['/tmp/a.png', '/tmp/b.png'],
            'context': '', 'created_at': 1, 'model': 'qwen',
        }]
        db.execute('UPDATE sessions SET payload=? WHERE owner=? AND id=?', (agent.json.dumps(session), setup.owner_profile_id, sid))
    monkeypatch.setattr(agent, 'complete', Mock(return_value='继续处理'))

    result = agent.send(sid, agent.MessageCreate(content='继续', asset_names=[]), setup)

    assert result['assistant_message']['content'] == '继续处理'


def test_current_duplicate_material_names_are_still_rejected(setup, monkeypatch):
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    with pytest.raises(HTTPException, match='参考素材名称重复'):
        agent.send(
            sid,
            agent.MessageCreate(
                content='使用素材',
                input_media=['/tmp/a.png', '/tmp/b.png'],
                asset_names=['same.png', 'same.png'],
            ),
            setup,
        )


def test_seedance_agent_keeps_filenames_in_model_context_and_answer(setup, monkeypatch):
    call = Mock(return_value='Seedance 提示词：让 `@1` 与 @2 在湖边唱歌')
    monkeypatch.setattr(agent, 'complete', call)
    monkeypatch.setattr(agent, 'reference_content', lambda ctx, ref: {'type': 'image_url', 'image_url': {'url': ref}})
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    agent.send(sid, agent.MessageCreate(
        content='优化 Seedance：@singer.jpg 与 @lake.png 在唱歌',
        input_media=['/tmp/singer.jpg', '/tmp/lake.png'],
        asset_names=['singer.jpg', 'lake.png'],
    ), setup)
    assert '@1 与 @2' in call.call_args.args[2][-1]['content'][0]['text']
    assert agent.messages(sid, setup)['messages'][-1]['content'] == 'Seedance 提示词：让 `@singer.jpg` 与 @lake.png 在湖边唱歌'


def test_chat_large_inline_history_is_rejected_before_network(setup, monkeypatch):
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={'api_key': 'test', 'base_url': 'https://example.test/v1'})))
    with pytest.raises(HTTPException) as exc:
        agent.complete(setup, 'qwen', [{'role': 'user', 'content': 'x' * (901 * 1024)}])
    assert exc.value.status_code == 422


def test_chat_keeps_more_than_sixteen_references_and_long_text(setup, monkeypatch):
    references = [f'/playground/input-media/{i}.png' for i in range(32)]
    monkeypatch.setattr(agent, 'reference_content', lambda ctx, ref: {'type': 'image_url', 'image_url': {'url': 'https://cdn.example/' + ref.rsplit('/', 1)[-1]}})
    call = Mock(return_value='分析完成')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), setup)['session']['id']
    prompt = '分析素材。' * 4000
    agent.send(sid, agent.MessageCreate(content=prompt, context=prompt, input_media=references,
        asset_names=[f'{i}.png' for i in range(32)]), setup)
    parts = call.call_args.args[2][-1]['content']
    assert parts[0]['text'].startswith(prompt)
    images = [part['image_url']['url'] for part in parts if part['type'] == 'image_url']
    assert images == [f'https://cdn.example/{i}.png' for i in range(32)]
    assert agent.messages(sid, setup)['messages'][0]['input_media'] == references


def test_chat_payload_budget_counts_utf8_bytes_not_escaped_chinese(setup, monkeypatch):
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={'api_key': 'test', 'base_url': 'https://example.test/v1'})))
    import openai
    client = Mock()
    client.chat.completions.create.return_value.model_dump.return_value = {'choices': [{'message': {'content': 'ok'}}]}
    factory = Mock()
    factory.return_value.__enter__ = Mock(return_value=client)
    factory.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(openai, 'OpenAI', factory)
    assert agent.complete(setup, 'qwen', [{'role': 'user', 'content': '文' * 200000}]) == 'ok'
    client.chat.completions.create.assert_called_once()
