import asyncio
import base64
import json
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.companion_runtime.api import router
from src.apps.companion_runtime import realtime as voice
from src.apps.identity import UserContext, require_user_context


class Upstream:
    def __init__(self):
        self.queue = asyncio.Queue()
        self.sent = []
    async def send(self, raw):
        event = json.loads(raw)
        self.sent.append(event)
        if event['type'] == 'session.update':
            await self.queue.put(json.dumps(dict(type='session.updated', session=dict(secret='never expose'))))
        elif event['type'] == 'input_audio_buffer.append':
            for value in [dict(type='response.created'), dict(type='conversation.item.input_audio_transcription.delta', item_id='user', text='今天', stash='很开心'), dict(type='conversation.item.input_audio_transcription.completed', item_id='user', transcript='今天很开心'), dict(type='response.audio.delta', delta='AAA=', provider_secret='never expose')]:
                await self.queue.put(json.dumps(value))
    def __aiter__(self): return self
    async def __anext__(self): return await self.queue.get()


@pytest.fixture
def client(monkeypatch):
    voice._tickets.clear(); voice._active.clear()
    app = FastAPI(); app.include_router(router)
    app.dependency_overrides[require_user_context] = lambda: UserContext('user','owner','','')
    monkeypatch.setattr(voice.channel, 'runtime', lambda _: dict(base_url='https://example.test/v1',api_key='private-key'))
    upstream = Upstream()
    class Connection:
        async def __aenter__(self): return upstream
        async def __aexit__(self, *args): return False
    connector = Mock(return_value=Connection())
    monkeypatch.setattr(voice, 'connect', connector)
    with TestClient(app) as c: yield c, upstream, connector
    assert not voice._active


def get_ticket(c):
    result = c.post('/companion-runtime/realtime/ticket',json=dict(allow_external_audio=True))
    assert result.status_code == 200
    assert 'private-key' not in result.text
    return result.json()['ticket']


def test_voice_consent_ticket_expiry_and_replay(client, monkeypatch):
    c,_,connector = client
    assert c.post('/companion-runtime/realtime/ticket',json=dict(allow_external_audio=False)).status_code == 422
    token = get_ticket(c)
    now = voice.time.monotonic()
    with monkeypatch.context() as clock:
        clock.setattr(voice.time, 'monotonic', lambda: now + 46)
        assert voice.consume_ticket(token) is None
    token = get_ticket(c)
    assert voice.consume_ticket(token).owner_profile_id == 'owner'
    assert voice.consume_ticket(token) is None
    connector.assert_not_called()


def test_native_relay_only_forwards_allowed_audio_and_sanitized_events(client):
    c,upstream,connector = client
    token = get_ticket(c)
    with c.websocket_connect('/companion-runtime/realtime',headers={'origin':'http://testserver'}) as ws:
        ws.send_json(dict(type='authenticate',ticket=token))
        assert ws.receive_json() == dict(type='ready')
        ws.send_json(dict(type='input_audio_buffer.append',audio=base64.b64encode(b'\0\0'*320).decode()))
        assert ws.receive_json()['type'] == 'response.created'
        assert ws.receive_json() == dict(type='conversation.item.input_audio_transcription.delta', item_id='user', text='今天', stash='很开心')
        assert ws.receive_json()['transcript'] == '今天很开心'
        assert ws.receive_json() == dict(type='response.audio.delta',delta='AAA=')
        ws.send_json(dict(type='interrupt'))
        # Unknown client commands terminate this connection instead of mutating model/tools.
        ws.send_json(dict(type='session.update',session=dict(tools=['unsafe'])))
        assert ws.receive_json()['type'] == 'error'
    assert [e['type'] for e in upstream.sent] == ['session.update','input_audio_buffer.append','response.cancel']
    config = upstream.sent[0]['session']
    assert config['input_audio_format'] == config['output_audio_format'] == 'pcm'
    assert config['voice'] == 'longanhuan_v3.1'
    assert 'tools' not in config and config['turn_detection']['type'] == 'server_vad'
    assert connector.call_args.args[0] == 'wss://example.test/v1/realtime?model=qwen-audio-3.1-realtime-plus'
    with c.websocket_connect('/companion-runtime/realtime',headers={'origin':'http://testserver'}) as ws:
        ws.send_json(dict(type='authenticate',ticket=token))
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect): ws.receive_json()
    assert connector.call_count == 1


def test_wrong_origin_never_connects_and_invalid_pcm_ends_session(client):
    from starlette.websockets import WebSocketDisconnect
    c,_,connector = client
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect('/companion-runtime/realtime',headers={'origin':'https://other.test'}): pass
    connector.assert_not_called()
    token = get_ticket(c)
    with c.websocket_connect('/companion-runtime/realtime',headers={'origin':'http://testserver'}) as ws:
        ws.send_json(dict(type='authenticate',ticket=token)); assert ws.receive_json()['type'] == 'ready'
        ws.send_json(dict(type='input_audio_buffer.append',audio='not base64!'))
        result = ws.receive_json()
        assert result['type'] == 'error' and 'private-key' not in str(result)


def test_failure_diagnostics_do_not_expose_credentials(client, monkeypatch, caplog):
    c,_,_=client
    class FailedConnection:
        async def __aenter__(self): raise RuntimeError('private-key and provider payload')
        async def __aexit__(self,*args): return False
    monkeypatch.setattr(voice,'connect',lambda *args,**kwargs:FailedConnection())
    token=get_ticket(c)
    with c.websocket_connect('/companion-runtime/realtime',headers={'origin':'http://testserver'}) as ws:
        ws.send_json(dict(type='authenticate',ticket=token))
        reply=ws.receive_json()
    assert reply['message']=='语音服务连接意外中断，麦克风已关闭，请重新开始。'
    assert 'private-key' not in caplog.text and 'provider payload' not in caplog.text
    assert 'last_event=connecting' in caplog.text and 'input_frames=0' in caplog.text


def test_failure_messages_distinguish_upstream_auth_and_timeout():
    class Rejected(Exception):
        status_code=401
    assert '鉴权失败' in voice.public_failure(Rejected())
    assert '超时' in voice.public_failure(asyncio.TimeoutError())
