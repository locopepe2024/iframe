"""Registered read-only companion tools backed by the existing photo store.

This is an adapter slice: it validates the public tool contract and delegates
actual owner-scoped reads to photo_tools. It does not mutate tasks or call a
model/provider.
"""
from typing import Any
from pydantic import Field

from .operation_protocol import Strict
from .photo_tools import read_photos
from .tool_runtime import ToolRegistry, ToolSpec
from .tools import CountPhotos, ListPhotos, ReadPhoto


class PhotoCountResult(Strict):
    total: int = Field(ge=0)
    spoken_text: str = Field(min_length=1, max_length=200)


class PhotoSummary(Strict):
    photo_id: str = Field(min_length=1, max_length=120)
    date: dict[str, Any]


class PhotoListResult(Strict):
    photos: list[PhotoSummary] = Field(max_length=12)
    next_after_id: str | None = None


class PhotoItemResult(Strict):
    photos: list[dict[str, Any]] = Field(min_length=1, max_length=1)
    next_after_id: None = None


def read_registry() -> ToolRegistry:
    return ToolRegistry([
        ToolSpec(name='photo.album.count', description='读取当前用户相册照片总数，不修改数据。',
                  input_model=CountPhotos, result_model=PhotoCountResult,
                  execution_mode='sync', effect='read', confirmation='none',
                  timeout_seconds=5, retry='same_operation', cancellation='unsupported',
                  preconditions=()),
        ToolSpec(name='photo.album.list', description='按时间或结构化资料分页读取照片，不修改数据。',
                  input_model=ListPhotos, result_model=PhotoListResult,
                  execution_mode='sync', effect='read', confirmation='none',
                  timeout_seconds=5, retry='same_operation', cancellation='unsupported',
                  preconditions=()),
        ToolSpec(name='photo.item.read', description='读取一张已授权照片的资料，不调用分析模型。',
                  input_model=ReadPhoto, result_model=PhotoItemResult,
                  execution_mode='sync', effect='read', confirmation='none',
                  timeout_seconds=5, retry='same_operation', cancellation='unsupported',
                  preconditions=('photo_id must come from a query result or user selection',)),
    ])


def execute_read(owner: str, name: str, arguments: dict) -> dict:
    """Execute one registered read; caller supplies authenticated owner."""
    spec = read_registry().get(name)
    values = spec.input_model.model_validate(arguments).model_dump()
    raw = read_photos(owner, name, values)
    # The result schema is the final boundary: provider/storage additions or
    # malformed records cannot be passed to the model as a successful result.
    return spec.result_model.model_validate(raw).model_dump()
