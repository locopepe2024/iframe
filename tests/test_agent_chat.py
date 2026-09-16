from unittest.mock import Mock

import pytest
import httpx
from openai import APIStatusError, APITimeoutError
from fastapi import HTTPException
from src.apps import agent_api as agent
from src.apps.identity import UserContext


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
