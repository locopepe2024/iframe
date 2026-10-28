"""Explicit UI task focus. Drafts are not saved photo facts or diary entries."""
import json
from datetime import date
from typing import Literal

from pydantic import Field, model_validator

from .tools import Strict

FOCUS_SCHEMA = """
CREATE TABLE IF NOT EXISTS companion_interaction_focus (
 owner TEXT NOT NULL, actor TEXT NOT NULL, session_id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(owner,actor,session_id)
);
CREATE TABLE IF NOT EXISTS companion_focus_operations (
 owner TEXT NOT NULL, actor TEXT NOT NULL, session_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(owner,actor,session_id,operation_id)
);
CREATE TABLE IF NOT EXISTS companion_turn_focus (
 owner TEXT NOT NULL, turn_id TEXT NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(owner,turn_id)
);
"""


class InteractionFocus(Strict):
    kind: Literal['chat', 'photo', 'diary'] = 'chat'
    object_id: str = Field(default='', max_length=120)
    phase: Literal['viewing', 'editing', 'listening', 'paused'] = 'viewing'
    draft: str = Field(default='', max_length=12000)

    @model_validator(mode='after')
    def valid_target(self):
        if self.kind == 'chat':
            if self.object_id or self.draft or self.phase != 'viewing':
                raise ValueError('Chat focus cannot contain an editing draft')
        elif not self.object_id:
            raise ValueError('Focus requires an object')
        elif self.kind == 'diary' and date.fromisoformat(self.object_id).isoformat() != self.object_id:
            raise ValueError('Invalid diary day')
        if self.kind == 'photo' and len(self.draft) > 4000:
            raise ValueError('Photo story exceeds capacity')
        return self


class FocusUpdate(Strict):
    operation_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9_-]+$')
    expected_revision: int = Field(ge=0)
    focus: InteractionFocus


def active_editor(focus):
    return bool(focus and focus['kind'] in ('photo', 'diary') and
                focus['phase'] in ('editing', 'listening', 'paused'))


def read_focus(db, owner, actor, session):
    row = db.execute('SELECT revision,payload FROM companion_interaction_focus WHERE owner=? AND actor=? AND session_id=?',
                     (owner, actor, session)).fetchone()
    return dict(revision=row['revision'], **json.loads(row['payload'])) if row else dict(revision=0, **InteractionFocus().model_dump())


def update_focus(store, owner, actor, session, body):
    from .store import Conflict, encode
    body = FocusUpdate.model_validate(body)
    payload = body.focus.model_dump()
    request = encode(dict(expected_revision=body.expected_revision, focus=payload))
    with store.connection(write=True) as db:
        store.one(db, 'companion_sessions', owner, session)
        old = db.execute('SELECT request,result FROM companion_focus_operations WHERE owner=? AND actor=? AND session_id=? AND operation_id=?',
                         (owner, actor, session, body.operation_id)).fetchone()
        if old:
            if old['request'] != request:
                raise Conflict('Focus operation changed')
            return json.loads(old['result'])
        if payload['kind'] == 'photo':
            from .photo_tools import photo_store
            from ..photos.date_store import PhotoNotAvailable
            from .store import Missing
            try:
                photo_store().read(owner, payload['object_id'])
            except PhotoNotAvailable as exc:
                raise Missing('Photo unavailable') from exc
        current = read_focus(db, owner, actor, session)
        if current['revision'] != body.expected_revision:
            raise Conflict('Focus changed')
        revision = current['revision'] + 1
        result = dict(revision=revision, **payload)
        db.execute('INSERT INTO companion_interaction_focus VALUES (?,?,?,?,?) ON CONFLICT(owner,actor,session_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
                   (owner, actor, session, revision, encode(payload)))
        db.execute('INSERT INTO companion_focus_operations VALUES (?,?,?,?,?,?)',
                   (owner, actor, session, body.operation_id, request, encode(result)))
        return result
