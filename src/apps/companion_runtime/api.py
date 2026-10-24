"""Opt-in routes for companion tools; no model provider or default app mount."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field

from ..identity import UserContext, require_user_context
from .store import Missing, Conflict
from .chat_store import ChatStore as CompanionStore
from .intent import classify
from .model import propose, propose_diary, ModelUnavailable
from .tools import Strict, dispatch, tool_schemas


class Operation(Strict):
    operation_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9_-]+$')


class UserMessage(Operation):
    text: str = Field(min_length=1, max_length=4000)


class ChatRequest(UserMessage):
    allow_external_text: Literal[True]


class DiarySave(Operation):
    text: str = Field(min_length=1, max_length=12000)
    source_turn_id: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=0)


class ToolRequest(Strict):
    name: Literal['memory.save', 'memory.search', 'memory.list', 'memory.delete']
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
        raise HTTPException(409, 'Companion state changed or capacity reached; review again') from exc
    except (sqlite3.Error, OSError) as exc:
        raise HTTPException(503, 'Companion storage unavailable') from exc
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422, 'Invalid companion request') from exc


Owner = Annotated[UserContext, Depends(require_user_context)]
Store = Annotated[CompanionStore, Depends(get_store)]
router = APIRouter(prefix='/companion-runtime', tags=['companion-runtime'])


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
def conversation(session_id: str, identity: Owner, store: Store, after: int = Query(default=0,ge=0), limit: int = Query(default=20,ge=1,le=100)):
    with errors():
        return store.conversation(identity.owner_profile_id, identity.user_id, session_id, after=after, limit=limit)


@router.get('/tools')
def schemas(identity: Owner):
    return dict(tools=tool_schemas())


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


@router.post('/cancel')
def cancel(body: Cancellation, identity: Owner, store: Store):
    with errors():
        return store.cancel(identity.owner_profile_id, identity.user_id, body.preview_token)


@router.post('/sessions/{session_id}/chat')
def chat(session_id: str, body: ChatRequest, identity: Owner, store: Store):
    with errors():
        claim=store.claim_turn(identity.owner_profile_id,identity.user_id,session_id,body.operation_id,body.text)
        if claim['cached']:
            return store.turn(identity.owner_profile_id,identity.user_id,claim['id'])
        try:
            # Diary is a writing lane. It receives the current session's user
            # messages but never receives memory tools, even if the model
            # would otherwise interpret the request as a search.
            intent=classify(body.text)
            proposal=({'kind':'upload_guide'} if intent.name == 'media.upload_help' else
                      (propose_diary if intent.name == 'diary.compose' else propose)(identity,claim['messages'],claim['message_id']))
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
