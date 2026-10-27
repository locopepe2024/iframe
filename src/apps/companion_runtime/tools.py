"""Strict memory and read-only photo tool boundary. Model-facing writes only return confirmation drafts."""
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


class ListPhotos(Strict):
    view: Literal['all', 'pending'] = 'all'
    year: int | None = Field(default=None, ge=1800, le=2200)
    query: str = Field(default='', max_length=100)
    after_id: str = Field(default='', max_length=120)
    limit: int = Field(default=6, ge=1, le=12)


class PhotoTaskCommand(Strict):
    task_id: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=1)
    action: Literal['select', 'close', 'cancel']
    photo_id: str | None = Field(default=None, max_length=120)


class ReadPhoto(Strict):
    photo_id: str = Field(min_length=1, max_length=120)


DESCRIPTIONS = {
    'photo.organize.input': '继续当前会话的相册任务。依据 workflow_tasks 的 task_id、revision 和按顺序排列的候选照片ID选择照片，或明确结束、取消。仅在用户明确要求时操作；有歧义先问清楚。',
    'photo.organize.start': '用户要求整理相册时，发起可恢复的相册整理工作流，先查询照片并等待用户选择。仅按已保存备注、讲述、年份筛选；没有日期用 pending。不会自动分析或保存修改。',
    'photo.album.list': '查找当前用户的相册照片。pending 仅表示没有归档年份；query 只匹配已保存的讲述和备注，不是看图搜索。不要编造照片ID。',
    'photo.item.read': '用查询结果中的 photo_id 查看照片已有信息并展示整理卡片。不会调用看图模型或修改照片；用户可在卡片里继续讲述或确认分析。',
}


MODELS = {'memory.save': SaveMemory, 'memory.search': SearchMemories,
          'memory.list': ListMemories, 'memory.delete': DeleteMemory,
          'photo.album.list': ListPhotos, 'photo.item.read': ReadPhoto, 'photo.organize.start': ListPhotos, 'photo.organize.input': PhotoTaskCommand}


def tool_schemas():
    return [dict(name=name, parameters=model.model_json_schema(),
                 effect='workflow_start' if name in ('photo.organize.start', 'photo.organize.input') else 'proposal_only' if name in ('memory.save','memory.delete') else 'read_only')
            for name, model in MODELS.items()]


def dispatch(store, owner, actor, name, arguments):
    if name not in MODELS:
        raise ValueError('Unknown companion tool')
    values = MODELS[name].model_validate(arguments).model_dump()
    if name == 'memory.save':
        return store.prepare(owner, actor, 'save', values)
    if name == 'memory.delete':
        return store.prepare(owner, actor, 'delete', values)
    if name in ('photo.organize.start', 'photo.organize.input'):
        raise ValueError('Workflow start requires a claimed chat turn')
    if name.startswith('photo.'):
        from .photo_tools import read_photos
        return read_photos(owner, name, values)
    return store.memories(owner, **values)
