"""Strict four-tool boundary. Model-facing writes only return confirmation drafts."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class SaveMemory(Strict):
    source_message_id: str = Field(min_length=1, max_length=80)
    quote: str = Field(min_length=1, max_length=4000)
    content: str = Field(min_length=1, max_length=1600)
    type: Literal['preference', 'personal_fact', 'photo_recollection']
    importance: int = Field(ge=1, le=5)


class DeleteMemory(Strict):
    memory_id: str = Field(min_length=1, max_length=80)


class ListMemories(Strict):
    type: Literal['preference', 'personal_fact', 'photo_recollection'] | None = None
    min_importance: int = Field(default=1, ge=1, le=5)
    cursor: str = Field(default='', max_length=1000)
    limit: int = Field(default=20, ge=1, le=100)


class SearchMemories(ListMemories):
    query: str = Field(min_length=1, max_length=100)


MODELS = {'memory.save': SaveMemory, 'memory.search': SearchMemories,
          'memory.list': ListMemories, 'memory.delete': DeleteMemory}


def tool_schemas():
    return [dict(name=name, parameters=model.model_json_schema(),
                 effect='proposal_only' if name in ('memory.save','memory.delete') else 'read_only')
            for name, model in MODELS.items()]


def dispatch(store, owner, actor, name, arguments):
    if name not in MODELS:
        raise ValueError('Unknown companion tool')
    values = MODELS[name].model_validate(arguments).model_dump()
    if name == 'memory.save':
        return store.prepare(owner, actor, 'save', values)
    if name == 'memory.delete':
        return store.prepare(owner, actor, 'delete', values)
    return store.memories(owner, **values)
