"""Opt-in routes for companion tools; no model provider or default app mount."""
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import Field

from ..identity import BROWSER_PROFILE_COOKIE, UserContext, require_user_context
from .store import Missing, Conflict
from .chat_store import ChatStore as CompanionStore
from .intent import classify
from .model import propose, propose_diary, ModelUnavailable
from .tools import StartMediaDraft, UpdateMediaDraft, Strict, dispatch, tool_schemas, CAPABILITIES
from .opentalking_binding import BindingUnavailable, SessionBindings
from .opentalking_context import ContextUnavailable, IframeContextReader
from .interaction_focus import FocusUpdate, read_focus, update_focus, active_editor


class Operation(Strict):
    operation_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9_-]+$')


class UserMessage(Operation):
    text: str = Field(min_length=1, max_length=4000)


class CreativeContext(Strict):
    task_id: str = Field(max_length=120)
    revision: int = Field(ge=0)


class ChatRequest(UserMessage):
    creative_context: CreativeContext | None = None
    allow_external_text: Literal[True]
    selected_photo_id: str | None = Field(default=None, min_length=1, max_length=120)


class DiarySave(Operation):
    text: str = Field(min_length=1, max_length=12000)
    source_turn_id: str = Field(max_length=120)
    expected_revision: int = Field(ge=0)


class PhotoTaskInput(Operation):
    expected_revision: int = Field(ge=1)
    action: Literal['select', 'close', 'cancel']
    photo_id: str | None = Field(default=None, max_length=120)


class ToolRequest(Strict):
    name: Literal['diary.open', 'diary.list', 'diary.read', 'memory.save', 'memory.search', 'memory.list', 'memory.delete', 'photo.album.count', 'photo.album.list', 'photo.item.read']
    arguments: dict


class Confirmation(Operation):
    preview_token: str = Field(pattern=r'^[a-f0-9]{64}$')
    method: Literal['button']


class Cancellation(Strict):
    preview_token: str = Field(pattern=r'^[a-f0-9]{64}$')


def get_store():
    configured = os.getenv('IFRAME_COMPANION_DB_PATH', '')
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, 'Companion storage is not configured')
    return CompanionStore(path)


@contextmanager
def errors():
    try:
        yield
    except Missing as exc:
        raise HTTPException(404, 'Companion record is unavailable') from exc
    except Conflict as exc:
        # Keep the stable status code, but return the boundary-specific reason
        # so the client can recover the active card instead of showing an
        # opaque capacity message.
        raise HTTPException(409, str(exc) or 'Companion state changed; review again') from exc
    except (sqlite3.Error, OSError) as exc:
        raise HTTPException(503, 'Companion storage unavailable') from exc
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, 'Invalid companion request') from exc


Owner = Annotated[UserContext, Depends(require_user_context)]
Store = Annotated[CompanionStore, Depends(get_store)]
router = APIRouter(prefix='/companion-runtime', tags=['companion-runtime'])
_opentalking_bindings = SessionBindings()


class OpenTalkingBindRequest(Strict):
    session_id: str = Field(min_length=1, max_length=100)
    ttl_seconds: int = Field(default=900, ge=60, le=3600)


class OpenTalkingContextRequest(Strict):
    query: str = Field(min_length=2, max_length=100)
    limit: int = Field(default=4, ge=1, le=8)


class OpenTalkingReleaseRequest(Strict):
    context_token: str = Field(min_length=1, max_length=200)


@router.post('/opentalking/bind')
def opentalking_bind(body: OpenTalkingBindRequest, request: Request, identity: Owner):
    """Bind a bearer identity, or an explicitly enabled demo browser workspace."""
    demo_mode = os.getenv('IFRAME_OPENTALKING_ALLOW_DEMO_IDENTITY', '').strip() == '1'
    identity_headers: dict[str, str] = {}
    if identity.access_token:
        identity_headers['Authorization'] = f'Bearer {identity.access_token}'
    elif demo_mode:
        browser_profile = request.cookies.get(BROWSER_PROFILE_COOKIE)
        if browser_profile:
            identity_headers['Cookie'] = f'{BROWSER_PROFILE_COOKIE}={browser_profile}'
        elif identity.owner_profile_id.startswith('apikey-'):
            identity_headers['X-iFrame-API-Key-Identity'] = identity.owner_profile_id.removeprefix('apikey-')
    if not identity_headers:
        raise HTTPException(401, 'OpenTalking context requires a verified login session')
    try:
        expires = time.time() + body.ttl_seconds
        _opentalking_bindings.bind(body.session_id, owner=identity.owner_profile_id,
            actor=identity.user_id, identity_headers=identity_headers,
            expires_at=expires, allow_demo_identity=demo_mode and not identity.access_token)
        token = _opentalking_bindings.issue_gateway_token(body.session_id,
            owner=identity.owner_profile_id, actor=identity.user_id)
        return {'context_token': token, 'expires_at': expires}
    except (BindingUnavailable, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/opentalking/context')
async def opentalking_context(body: OpenTalkingContextRequest,
                              context_token: str | None = Header(default=None, alias='X-OpenTalking-Context-Token')):
    if not context_token:
        raise HTTPException(401, 'Context token is required')
    try:
        _, binding = _opentalking_bindings.resolve_gateway_token(context_token)
    except BindingUnavailable as exc:
        raise HTTPException(401, str(exc)) from exc
    companion_base = os.getenv('IFRAME_OPENTALKING_COMPANION_BASE', '').strip()
    knowledge_base = os.getenv('IFRAME_OPENTALKING_KNOWLEDGE_BASE', '').strip()
    if not companion_base or not knowledge_base:
        raise HTTPException(503, 'OpenTalking context gateway is not configured')
    async with httpx.AsyncClient() as client:
        reader = IframeContextReader(client, companion_base=companion_base,
            knowledge_base=knowledge_base, identity_headers=binding.headers)
        try:
            fragments = await reader.search(body.query, limit=body.limit)
        except (ContextUnavailable, httpx.HTTPError, ValueError) as exc:
            raise HTTPException(503, 'Context retrieval unavailable') from exc
    return {'fragments': [item.__dict__ for item in fragments]}


@router.post('/opentalking/release')
def opentalking_release(body: OpenTalkingReleaseRequest):
    try:
        session_id = _opentalking_bindings.release_gateway_token(body.context_token)
    except BindingUnavailable as exc:
        raise HTTPException(401, str(exc)) from exc
    return {'session_id': session_id, 'status': 'released'}


@router.get('/diaries')
def diaries(identity: Owner, store: Store, month: str = Query(pattern=r'^\d{4}-\d{2}$')):
    with errors():
        return store.diaries(identity.owner_profile_id, identity.user_id, month)


@router.put('/diaries/{day}')
def save_diary(day: str, body: DiarySave, identity: Owner, store: Store):
    with errors():
        return store.save_diary(identity.owner_profile_id, identity.user_id, day, **body.model_dump())


@router.post('/sessions')
def session(body: Operation, identity: Owner, store: Store):
    with errors():
        return store.session(identity.owner_profile_id, body.operation_id)


@router.post('/sessions/{session_id}/messages')
def message(session_id: str, body: UserMessage, identity: Owner, store: Store):
    with errors():
        return store.message(identity.owner_profile_id, session_id, body.operation_id, body.text)


@router.get('/sessions/{session_id}/messages')
def messages(session_id: str, identity: Owner, store: Store, after: int = Query(default=0,ge=0), limit: int = Query(default=20,ge=1,le=100)):
    with errors():
        return store.messages(identity.owner_profile_id, session_id, after=after, limit=limit)


@router.get('/sessions/{session_id}/conversation')
def conversation(session_id: str, identity: Owner, store: Store, after: int = Query(default=0,ge=0), limit: int = Query(default=20,ge=1,le=100), latest: bool = False, before: int | None = Query(default=None,ge=1)):
    with errors():
        return store.conversation(identity.owner_profile_id, identity.user_id, session_id, after=after, limit=limit, latest=latest, before=before)


@router.get('/sessions/{session_id}/focus')
def focus(session_id: str, identity: Owner, store: Store):
    with errors(), store.connection() as db:
        store.one(db, 'companion_sessions', identity.owner_profile_id, session_id)
        return read_focus(db, identity.owner_profile_id, identity.user_id, session_id)


@router.put('/sessions/{session_id}/focus')
def set_focus(session_id: str, body: FocusUpdate, identity: Owner, store: Store):
    with errors():
        return update_focus(store, identity.owner_profile_id, identity.user_id, session_id, body)


@router.get('/tools')
def schemas(identity: Owner):
    return dict(tools=tool_schemas(), capabilities=CAPABILITIES)


@router.post('/tools')
def tools(body: ToolRequest, identity: Owner, store: Store):
    with errors():
        return dispatch(store, identity.owner_profile_id, identity.user_id, body.name, body.arguments)


@router.get('/memories/{memory_id}')
def memory(memory_id: str, identity: Owner, store: Store):
    with errors():
        return store.memory(identity.owner_profile_id, memory_id)


@router.post('/confirmations')
def confirm(body: Confirmation, identity: Owner, store: Store):
    with errors():
        return store.confirm(identity.owner_profile_id, identity.user_id, body.preview_token, body.operation_id)


@router.get('/photo-tasks/{task_id}')
def photo_task(task_id: str, identity: Owner, store: Store):
    with errors():
        return store.photo_task(identity.owner_profile_id, identity.user_id, task_id)


@router.post('/photo-tasks/{task_id}/input')
def photo_task_input(task_id: str, body: PhotoTaskInput, identity: Owner, store: Store):
    with errors():
        return store.update_photo_task(identity.owner_profile_id, identity.user_id, task_id, body.model_dump())


class MediaDraftStart(Operation, StartMediaDraft):
    pass


class MediaDraftInput(Operation, UpdateMediaDraft):
    pass


@router.get('/sessions/{session_id}/media-drafts')
def media_drafts(session_id: str, identity: Owner, store: Store):
    with errors(), store.connection() as db:
        store.one(db, 'companion_sessions', identity.owner_profile_id, session_id)
        rows = db.execute("SELECT id FROM companion_media_drafts WHERE owner=? AND actor=? AND session_id=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,rowid DESC LIMIT 5",
                          (identity.owner_profile_id, identity.user_id, session_id)).fetchall()
        return dict(tasks=[store.media_draft(identity.owner_profile_id, identity.user_id, row['id']) for row in rows])


@router.post('/sessions/{session_id}/media-drafts')
def start_media_draft(session_id: str, body: MediaDraftStart, identity: Owner, store: Store):
    with errors():
        with store.connection() as db:
            if active_editor(read_focus(db, identity.owner_profile_id, identity.user_id, session_id)):
                raise Conflict('Return to chat before starting a creative task')
        return store.start_media_draft(identity.owner_profile_id, identity.user_id, session_id,
                                       body.operation_id, body.model_dump(exclude={'operation_id'}))


@router.post('/sessions/{session_id}/media-drafts/input')
def input_media_draft(session_id: str, body: MediaDraftInput, identity: Owner, store: Store):
    with errors():
        return store.update_media_draft(identity.owner_profile_id, identity.user_id, session_id, body.task_id,
                                        body.operation_id, body.model_dump(exclude={'operation_id','task_id'}))


def creative_shortcut(text):
    parts = text.strip().split(maxsplit=1)
    command = parts[0] if parts else ''
    brief = parts[1] if len(parts) > 1 else ''
    kinds = {'/图像编辑':'image_edit', '/图像生成':'image_generate', '/视频生成':'video_generate'}
    if command in kinds:
        return dict(kind='tool', name='media.draft.start', arguments=dict(type=kinds[command], brief=brief.strip()))
    if command.startswith('/'):
        return dict(kind='text', text='可以使用 /图像编辑、/图像生成 或 /视频生成，也可以直接告诉我想做什么。')
    return None


@router.post('/cancel')
def cancel(body: Cancellation, identity: Owner, store: Store):
    with errors():
        return store.cancel(identity.owner_profile_id, identity.user_id, body.preview_token)


@router.post('/sessions/{session_id}/chat')
def chat(session_id: str, body: ChatRequest, identity: Owner, store: Store):
    with errors():
        claim=store.claim_turn(identity.owner_profile_id,identity.user_id,session_id,body.operation_id,body.text,body.selected_photo_id)
        if claim['cached']:
            return store.turn(identity.owner_profile_id,identity.user_id,claim['id'])
        try:
            intent = classify(body.text)
            editing = active_editor(claim['messages'][-1].get('interaction_focus'))
            if body.creative_context is not None:
                current = claim['messages'][-1].get('active_media_draft')
                expected = dict(task_id=current['task_id'],revision=current['revision']) if current else dict(task_id='',revision=0)
                if body.creative_context.model_dump() != expected:
                    raise Conflict('Creative task changed since this sentence was captured; review before resending')
            # Diary is a writing lane. It receives the current session's user
            # messages but never receives memory tools, even if the model
            # would otherwise interpret the request as a search.
            if body.selected_photo_id:
                proposal = dict(kind='tool', name='photo.organize.start', arguments=dict(photo_id=body.selected_photo_id))
            elif not editing and creative_shortcut(body.text):
                proposal = creative_shortcut(body.text)
            elif editing:
                proposal = propose(identity, claim['messages'], claim['message_id'])
            elif intent.name in ('album.scope', 'album.browse'):
                proposal = dict(kind='album_guide')
            elif intent.name == 'media.upload_help':
                proposal = dict(kind='upload_guide')
            else:
                proposal = (propose_diary if intent.name == 'diary.compose' else propose)(identity, claim['messages'], claim['message_id'])
            return store.finish_turn(identity.owner_profile_id,identity.user_id,claim,proposal)
        except Exception as exc:
            store.fail_turn(identity.owner_profile_id,claim)
            if isinstance(exc,ModelUnavailable):
                raise HTTPException(503,'Qwen暂不可用，原话已保留；请用原请求重试。') from exc
            raise


@router.get('/turns/{turn_id}')
def turn(turn_id: str, identity: Owner, store: Store):
    with errors():
        return store.turn(identity.owner_profile_id,identity.user_id,turn_id)


@router.get('/previews/{token}')
def preview(token: str, identity: Owner, store: Store):
    with errors():
        return store.preview(identity.owner_profile_id,identity.user_id,token)


from .media_routes import router as media_router
router.include_router(media_router)

from .realtime import router as realtime_router
router.include_router(realtime_router)
