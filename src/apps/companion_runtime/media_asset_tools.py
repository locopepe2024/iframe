"""Registered source-card and asset-binding contracts for media tasks.

The adapter accepts only authenticated, server-verified photo IDs. It never
turns a card display into an asset selection and never generates media.
"""
from typing import Literal
from pydantic import Field

from .operation_protocol import Strict
from .tool_runtime import ToolRegistry, ToolSpec, WaitSpec


class SourceRequestArgs(Strict):
    source: Literal['upload', 'album', 'ask']


class SourceCardResult(Strict):
    card_id: str = Field(min_length=1, max_length=200)
    task_id: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    source: Literal['upload', 'album', 'ask']
    status: Literal['waiting_user']


class PhotoSelected(Strict):
    photo_id: str = Field(min_length=1, max_length=120)
    card_id: str = Field(min_length=1, max_length=200)
    task_id: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    slot: Literal['source', 'first_frame', 'last_frame', 'reference'] = 'source'


class AssetBindArgs(Strict):
    task_id: str = Field(min_length=1, max_length=120)
    photo_id: str = Field(min_length=1, max_length=120)
    slot: Literal['source', 'first_frame', 'last_frame', 'reference'] = 'source'
    selection_event_id: str = Field(min_length=1, max_length=160)


class AssetBindResult(Strict):
    task_id: str = Field(min_length=1, max_length=120)
    photo_id: str = Field(min_length=1, max_length=120)
    slot: Literal['source', 'first_frame', 'last_frame', 'reference']
    bound: Literal[True] = True
    task_revision: int = Field(ge=1)


class AssetBinding:
    def __init__(self, *, photo_exists):
        self.photo_exists = photo_exists

    def registry(self):
        return ToolRegistry([
            ToolSpec(name='media.source.request', description='打开上传或相册来源卡片并等待用户选择。',
                      input_model=SourceRequestArgs, result_model=SourceCardResult,
                      execution_mode='sync', effect='draft', confirmation='none',
                      timeout_seconds=900, retry='same_operation', cancellation='acknowledged',
                      preconditions=('active media task without bound source',), waits=(WaitSpec(
                          card_type='media_source_picker', events={'photo_selected': PhotoSelected}),)),
            ToolSpec(name='media.asset.bind', description='把服务端已验证的照片绑定到当前任务。',
                      input_model=AssetBindArgs, result_model=AssetBindResult,
                      execution_mode='sync', effect='draft', confirmation='none',
                      timeout_seconds=10, retry='same_operation', cancellation='unsupported',
                      preconditions=('selection event is valid and photo belongs to owner',)),
        ])

    def validate_bind(self, owner, args):
        values = AssetBindArgs.model_validate(args)
        if not self.photo_exists(owner, values.photo_id):
            raise ValueError('Photo is unavailable for this owner')
        return values.model_dump()
