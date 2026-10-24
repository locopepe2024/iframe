"""Bounded native Qwen realtime bridge; credentials never reach the browser."""
import asyncio
import base64
import binascii
import json
import logging
import os
import secrets
import threading
import time
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from websockets.legacy.client import connect

from .api import Owner
from . import channel
from .personality import get_profile, system_prompt

logger = logging.getLogger(__name__)
router = APIRouter(tags=['companion-voice'])
MODEL = 'qwen-audio-3.1-realtime-plus'
SESSION_SECONDS = 300
_tickets = {}
_active = set()
_lock = threading.Lock()


class VoiceConsent(BaseModel):
    allow_external_audio: bool


@router.post('/realtime/ticket')
def ticket(body: VoiceConsent, identity: Owner):
    if body.allow_external_audio is not True:
        raise HTTPException(422, '请先同意发送语音。')
    # Resolve now to report configuration errors before acquiring the microphone.
    channel.runtime(identity)
    now = time.monotonic()
    with _lock:
        for key in list(_tickets):
            if _tickets[key][0] <= now:
                del _tickets[key]
        if len(_tickets) >= 1000:
            raise HTTPException(429, '请稍后再试。')
        value = secrets.token_urlsafe(32)
        _tickets[value] = (now + 45, identity)
    return dict(ticket=value, expires_in=45, max_seconds=SESSION_SECONDS)


def consume_ticket(value):
    with _lock:
        item = _tickets.pop(value, None)
    return item[1] if item and item[0] > time.monotonic() else None


def session_update():
    return dict(type='session.update', session=dict(
        modalities=['text', 'audio'], voice='longanhuan_v3.1',
        input_audio_format='pcm', output_audio_format='pcm',
        input_audio_transcription=dict(language='zh'),
        turn_detection=dict(type='server_vad', threshold=0.5, silence_duration_ms=1000),
        instructions=system_prompt(get_profile(os.getenv("IFRAME_COMPANION_PERSONALITY"))) + '\n当前是实时语音聊天。用自然简短的中文回答。'
        '本次语音会话没有外部工具，也没有相册、日记或文字聊天历史。'
        '请用户通过文字输入和卡片完成保存记忆、生成、日记及提醒，绝不声称已执行。'))


async def relay(client, upstream):
    """Only allow PCM input and interruption; never arbitrary session/tool events."""
    responding = False

    async def input_loop():
        nonlocal responding
        total = 0
        while True:
            raw = await client.receive_text()
            if len(raw) > 24000:
                raise ValueError('event limit')
            event = json.loads(raw)
            kind = event.get('type')
            if kind == 'input_audio_buffer.append':
                audio = event.get('audio')
                if not isinstance(audio, str):
                    raise ValueError('audio type')
                try:
                    pcm = base64.b64decode(audio, validate=True)
                except (ValueError, binascii.Error):
                    raise ValueError('invalid PCM') from None
                total += len(pcm)
                if not pcm or len(pcm) % 2 or len(pcm) > 16000 or total > 12 * 1024 * 1024:
                    raise ValueError('audio limit')
                await upstream.send(json.dumps(dict(type=kind, audio=audio)))
            elif kind == 'interrupt':
                if responding:
                    await upstream.send(json.dumps(dict(type='response.cancel')))
                    responding = False
            else:
                raise ValueError('event not allowed')

    async def output_loop():
        nonlocal responding
        async for raw in upstream:
            if not isinstance(raw, str) or len(raw) > 4 * 1024 * 1024:
                raise ValueError('upstream event limit')
            event = json.loads(raw)
            kind = event.get('type')
            if kind == 'error':
                await client.send_json(dict(type='error', message='语音服务暂不可用，请检查渠道或余额后重新开始。'))
                return
            if kind == 'session.updated':
                await client.send_json(dict(type='ready'))
            elif kind == 'response.created':
                responding = True
                await client.send_json(dict(type=kind))
            elif kind == 'response.done':
                responding = False
                await client.send_json(dict(type=kind))
            elif kind in {'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped'}:
                await client.send_json(dict(type=kind))
            elif kind in {'response.audio.delta', 'response.audio_transcript.delta',
                          'response.audio_transcript.done', 'conversation.item.input_audio_transcription.delta',
                          'conversation.item.input_audio_transcription.completed'}:
                safe = {k: event[k] for k in ('type', 'delta', 'text', 'stash', 'transcript', 'item_id', 'response_id') if k in event}
                await client.send_json(safe)

    tasks = [asyncio.create_task(input_loop()), asyncio.create_task(output_loop())]
    try:
        done, _ = await asyncio.wait(tasks, timeout=SESSION_SECONDS, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
        if not done:
            await client.send_json(dict(type='ended', message='本次语音已到五分钟，您可以重新开始。'))
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@router.websocket('/realtime')
async def realtime(socket: WebSocket):
    origin = urlsplit(socket.headers.get('origin', ''))
    # No cookies or third-party pages may start a voice session via CSWSH.
    if origin.scheme not in {'https', 'http'} or origin.netloc != socket.headers.get('host'):
        await socket.close(code=1008)
        return
    await socket.accept()
    owner = None
    try:
        raw = await asyncio.wait_for(socket.receive_text(), timeout=10)
        if len(raw) > 500:
            raise ValueError('auth limit')
        auth = json.loads(raw)
        identity = consume_ticket(auth.get('ticket', '')) if auth.get('type') == 'authenticate' else None
        if identity is None:
            await socket.close(code=1008)
            return
        owner = identity.owner_profile_id
        with _lock:
            if owner in _active:
                owner = None
                raise ValueError('already active')
            _active.add(owner)
        config = await asyncio.to_thread(channel.runtime, identity)
        parsed = urlsplit(config['base_url'])
        url = urlunsplit(('wss', parsed.netloc, parsed.path.rstrip('/') + '/realtime', 'model=' + MODEL, ''))
        async with connect(url, extra_headers={'Authorization': 'Bearer ' + config['api_key']},
                           open_timeout=15, close_timeout=3, max_size=4*1024*1024, max_queue=16) as upstream:
            await upstream.send(json.dumps(session_update(), ensure_ascii=False))
            await relay(socket, upstream)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Companion realtime connection failed: %s", type(exc).__name__)
        try:
            await socket.send_json(dict(type='error', message='语音连接已结束，请检查渠道、网络或麦克风后重新开始。'))
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        if owner:
            with _lock:
                _active.discard(owner)
        try:
            await socket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
