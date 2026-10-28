"""Explicit demo generation and TTS through the owner's UniArt channel."""
import hashlib
import sqlite3
import json
import tempfile
import uuid
from pathlib import Path
from typing import Literal

import requests
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import Field

from .api import Owner, Store
from .tools import Strict
from .photo_tools import photo_store
from .store import Missing
from ..photos.date_store import PhotoNotAvailable
from . import channel
from ..user_config import UserConfigUpdate
from ...utils.uniart_catalog import fetch_uniart_catalog

router = APIRouter(tags=['companion-media'])


class ChannelUpdate(Strict):
    api_key: str | None = Field(default=None, max_length=1000)
    base_url: str = Field(default='https://uniart.fun/v1', max_length=500)


class Generate(Strict):
    operation_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,120}$')
    mode: Literal['image', 'video']
    model: str = Field(min_length=1, max_length=160)
    prompt: str = Field(min_length=1, max_length=4000)
    setting: str = Field(max_length=40)
    reference: str | None = Field(default=None, min_length=1, max_length=120)
    task_id: str | None = Field(default=None, min_length=1, max_length=120)
    expected_revision: int | None = Field(default=None, ge=1)
    allow_external_generation: Literal[True]


class Speech(Strict):
    text: str = Field(min_length=1, max_length=3000)
    voice: Literal['longanhuan_v3.6', 'longanyang_v3.6'] = 'longanhuan_v3.6'
    allow_external_text: Literal[True]


def initialize(store):
    with store.connection(write=True) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS companion_generations (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, operation_id TEXT NOT NULL,
        digest TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
        path TEXT, UNIQUE(owner,operation_id))''')


@router.get('/channel')
def get_channel(identity: Owner):
    return channel.public(identity)


@router.put('/channel')
def set_channel(body: ChannelUpdate, identity: Owner):
    if not body.base_url.startswith('https://'):
        raise HTTPException(422, '请使用 HTTPS API 地址。')
    key = body.api_key
    if not key:
        try:
            key = channel.runtime(identity)['api_key']
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
    channel.local_store().update(identity, UserConfigUpdate(UNIART_API_KEY=key, UNIART_BASE_URL=body.base_url))
    return channel.public(identity)


@router.get('/channel/models')
def models(identity: Owner):
    try:
        return dict(models=fetch_uniart_catalog(channel.runtime(identity)))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, '模型列表读取失败，请检查渠道配置。') from None


def job(store, owner, job_id):
    with store.connection() as db:
        row = db.execute('SELECT * FROM companion_generations WHERE id=? AND owner=?', (job_id, owner)).fetchone()
        if row is None:
            raise HTTPException(404, '生成任务不存在。')
        return dict(row)


def execute(store, identity, job_id, body, config, options):
    # A crash leaves an uncertain running task; it is never automatically resubmitted.
    output = store.path.parent / 'companion-generated' / (job_id + ('.png' if body.mode == 'image' else '.mp4'))
    try:
        from ...models.uniart import UniArtImageModel, UniArtVideoModel
        output.parent.mkdir(exist_ok=True)
        options = dict(options)
        reference_media = options.pop('_reference_media', None)
        # The shared adapter publishes local files via managed storage; never send blobs/data URLs.
        with tempfile.TemporaryDirectory(prefix='companion-reference-') as directory:
            if reference_media:
                content, mime = reference_media
                suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}.get(mime)
                if not suffix:
                    raise ValueError('Unsupported reference image type')
                material = Path(directory) / ('reference' + suffix)
                material.write_bytes(content)
                options['ref_image_path' if body.mode == 'image' else 'img_path'] = str(material)
            if body.mode == 'image':
                ratio = body.setting.split()[-1]
                UniArtImageModel(config).generate(body.prompt, str(output), model_name=body.model, aspect_ratio=ratio, **options)
            else:
                UniArtVideoModel(config).generate(body.prompt, str(output), model_name=body.model, duration=int(body.setting.split()[0]), generate_audio=False, **options)
        if not output.is_file() or output.stat().st_size == 0:
            raise ValueError('Missing generated file')
        status = 'completed'
    except Exception:
        status = 'failed'
    with store.connection(write=True) as db:
        db.execute('UPDATE companion_generations SET status=?,path=? WHERE id=? AND owner=?',
                   (status, str(output) if status == 'completed' else None, job_id, identity.owner_profile_id))


def checked_draft(db, store, identity, body):
    if not body.task_id:
        if body.expected_revision is not None or body.reference:
            raise HTTPException(422, '请从当前创作卡片确认素材与要求。')
        return None
    try:
        row = store.one(db, 'companion_media_drafts', identity.owner_profile_id, body.task_id)
    except Missing:
        raise HTTPException(404, '创作任务不存在。') from None
    if row['actor'] != identity.user_id:
        raise HTTPException(404, '创作任务不存在。')
    payload = json.loads(row['payload'])
    expected_mode = 'video' if payload['type'] == 'video_generate' else 'image'
    if (row['status'] != 'active' or row['revision'] != body.expected_revision
            or body.mode != expected_mode or body.prompt != payload['brief']
            or body.reference != payload['photo_id']
            or body.setting != payload.get('setting', '5 秒' if expected_mode == 'video' else '方形 1:1')):
        raise HTTPException(409, '创作要求已改变，请查看当前卡片再确认。')
    if not payload['brief'].strip() or (payload['type'] == 'image_edit' and not payload['photo_id']):
        raise HTTPException(422, '请先补充具体要求和需要修改的照片。')
    return payload


@router.post('/generations')
def generate(body: Generate, identity: Owner, store: Store, background: BackgroundTasks):
    initialize(store)
    digest = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    with store.connection() as db:
        old = db.execute('SELECT * FROM companion_generations WHERE owner=? AND operation_id=?', (identity.owner_profile_id, body.operation_id)).fetchone()
    if old:
        if old['digest'] != digest:
            raise HTTPException(409, '原生成请求已改变。')
        return dict(id=old['id'], status=old['status'])
    with store.connection() as db:
        checked_draft(db, store, identity, body)
    config = channel.runtime(identity)
    try:
        catalog = fetch_uniart_catalog(config)
    except Exception:
        raise HTTPException(502, '模型列表读取失败，请检查渠道配置。') from None
    capability = ('i2i' if body.reference else 't2i') if body.mode == 'image' else ('i2v' if body.reference else 't2v')
    selected = next((m for m in catalog if m['id'] == body.model and capability in m['capabilities']), None)
    if not selected:
        raise HTTPException(422, '请选择支持当前创作类型的模型。')
    params = selected.get('params') or {}
    options = {}
    resolution = params.get('size' if body.mode == 'image' else 'resolution') or {}
    if resolution.get('default'):
        options['size' if body.mode == 'image' else 'resolution'] = resolution['default']
    if body.mode == 'image' and body.setting not in ('方形 1:1', '横向 16:9', '竖向 9:16'):
        raise HTTPException(422, '图片比例不支持。')
    if body.mode == 'image':
        ratios = (params.get('ratio') or {}).get('options') or []
        if ratios and body.setting.split()[-1] not in ratios:
            raise HTTPException(422, '所选模型不支持该比例。')
    if body.mode == 'video':
        duration = selected.get('duration') or {}
        seconds = int(body.setting.split()[0]) if body.setting in ('5 秒', '10 秒') else 0
        if not seconds or not duration.get('min', 999) <= seconds <= duration.get('max', 0):
            raise HTTPException(422, '所选模型不支持该时长。')
    if body.reference:
        try:
            content, mime = photo_store().media(identity.owner_profile_id, body.reference, thumbnail=False)
        except PhotoNotAvailable:
            raise HTTPException(404, '参考照片不可用，请重新选择。') from None
        if mime not in ('image/jpeg', 'image/png', 'image/webp'):
            raise HTTPException(422, '请选择照片作为参考素材。')
        options['_reference_media'] = (content, mime)
    job_id = str(uuid.uuid4())
    try:
        with store.connection(write=True) as db:
            # Recheck under the same write transaction that reserves the paid operation.
            old = db.execute('SELECT * FROM companion_generations WHERE owner=? AND operation_id=?', (identity.owner_profile_id, body.operation_id)).fetchone()
            if old:
                if old['digest'] != digest:
                    raise HTTPException(409, '原生成请求已改变。')
                return dict(id=old['id'], status=old['status'])
            payload = checked_draft(db, store, identity, body)
            if payload is not None:
                payload['job_id'] = job_id
                db.execute("UPDATE companion_media_drafts SET status='submitted',revision=revision+1,payload=? WHERE id=? AND owner=? AND actor=?",
                           (json.dumps(payload, ensure_ascii=False), body.task_id, identity.owner_profile_id, identity.user_id))
            db.execute('INSERT INTO companion_generations VALUES (?,?,?,?,?,?,NULL)', (job_id, identity.owner_profile_id, body.operation_id, digest, body.mode, 'running'))
    except sqlite3.IntegrityError:
        raise HTTPException(409, '该请求已在处理，请查询任务。') from None
    background.add_task(execute, store, identity, job_id, body, config, options)
    return dict(id=job_id, status='running')


@router.get('/generations/{job_id}')
def get_job(job_id: str, identity: Owner, store: Store):
    initialize(store)
    row = job(store, identity.owner_profile_id, job_id)
    return dict(id=row['id'], status=row['status'], mode=row['mode'])


@router.get('/generations/{job_id}/media')
def get_media(job_id: str, identity: Owner, store: Store):
    initialize(store)
    row = job(store, identity.owner_profile_id, job_id)
    if row['status'] != 'completed' or not row['path'] or not Path(row['path']).is_file():
        raise HTTPException(409, '生成结果尚未就绪。')
    return FileResponse(row['path'], media_type='image/png' if row['mode'] == 'image' else 'video/mp4', headers={'Cache-Control': 'no-store'})


@router.post('/speech')
def speech(body: Speech, identity: Owner):
    config = channel.runtime(identity)
    try:
        with requests.post(config['base_url'].rstrip('/')+'/audio/speech',
                           headers={'Authorization': 'Bearer '+config['api_key']},
                           json=dict(model='qwen-audio-3.0-tts-flash', input=body.text, voice=body.voice, response_format='wav', speed=1),
                           stream=True, timeout=(10,90)) as response:
            response.raise_for_status()
            chunks=[]; size=0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 16*1024*1024:
                    raise ValueError('audio limit')
                chunks.append(chunk)
            audio=b''.join(chunks)
            if not audio.startswith(b'RIFF') or audio[8:12] != b'WAVE':
                raise ValueError('invalid WAV')
        return Response(audio, media_type='audio/wav', headers={'Cache-Control':'no-store'})
    except Exception:
        raise HTTPException(502, '朗读生成失败，请检查渠道；不会自动重试。') from None
