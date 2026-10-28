"""Strict memory and read-only photo tool boundary. Model-facing writes only return confirmation drafts."""
from typing import Literal
from datetime import date
from pydantic import field_validator

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


class OpenDiary(Strict):
    pass


class ListDiaries(Strict):
    month: str = Field(pattern=r'^\d{4}-\d{2}$')

    @field_validator('month')
    @classmethod
    def valid_month(cls, value):
        date.fromisoformat(value + '-01')
        return value


class ReadDiary(Strict):
    day: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')

    @field_validator('day')
    @classmethod
    def valid_day(cls, value):
        date.fromisoformat(value)
        return value


class ListPhotos(Strict):
    view: Literal['all', 'pending'] = 'all'
    year: int | None = Field(default=None, ge=1800, le=2200)
    query: str = Field(default='', max_length=100)
    date_prefix: str = Field(default='', max_length=10)
    order: Literal['id', 'recent'] = 'id'
    after_id: str = Field(default='', max_length=120)
    limit: int = Field(default=6, ge=1, le=12)


class OrganizePhotos(ListPhotos):
    photo_id: str | None = Field(default=None, max_length=120)


class PhotoTaskCommand(Strict):
    task_id: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=1)
    action: Literal['select', 'close', 'cancel']
    photo_id: str | None = Field(default=None, max_length=120)


class PhotoAction(Strict):
    photo_id: str = Field(min_length=1, max_length=120)
    action: Literal['analyze', 'edit', 'delete']
    # Only explicit user corrections; partial facts are merged for preview.
    changes: dict = Field(default_factory=dict)


class ReadPhoto(Strict):
    photo_id: str = Field(min_length=1, max_length=120)


CAPABILITIES = [
    dict(name='album', description='打开和查询站内相册、查看照片、发起与继续整理工作流；分析及修改需用户确认。', tools=['photo.album.list', 'photo.item.read', 'photo.organize.start', 'photo.organize.input', 'photo.action']),
    dict(name='diary', description='打开日记月历、按月查询、按日期阅读已保存日记。写日记使用独立写作入口；保存与修改由编辑器确认。', tools=['diary.open', 'diary.list', 'diary.read']),
    dict(name='memory', description='查询个人记忆；保存、删除需用户确认。', tools=['memory.save', 'memory.search', 'memory.list', 'memory.delete']),
]


DESCRIPTIONS = {
    'photo.action': '对当前选中的照片请求分析、修改资料或删除。只生成待确认卡片，不声称已完成。action=analyze需要用户确认外部看图；edit的changes仅填写用户明确说出的people、scene、lighting、location、latitude、longitude、capture_time、notes，未修改字段不传；姓名/年龄不得猜。delete必须确认。photo_id只可从工作流状态取得；没有选中照片先请用户选择。',
    'diary.open': '用户要求打开日记、查看日记本时展示日记月历入口。不保存或生成日记。',
    'diary.list': '按明确的 YYYY-MM 月份查询当前用户已保存日记。不要用记忆搜索代替日记查询；月份不清楚先询问。',
    'diary.read': '按明确的 YYYY-MM-DD 日期阅读当前用户已保存的日记，并展示可编辑的日记卡片。不修改或编造正文。',

    'photo.organize.input': '继续当前会话的相册任务。依据 workflow_tasks 的 task_id、revision 和按顺序排列的候选照片ID选择照片，或明确结束、取消。仅在用户明确要求时操作；有歧义先问清楚。',
    'photo.organize.start': '先询问时间或人物范围；泛泛要求整理相册时不要无条件查询。明确范围后发起可恢复的相册整理工作流，先查询照片并等待用户选择。date_prefix 可用 YYYY、YYYY-MM、YYYY-MM-DD；query 只匹配用户保存的备注或故事，不能猜测亲属。仅按已保存备注、讲述、年份筛选；没有日期用 pending。不会自动分析或保存修改。',
    'photo.album.list': '查找当前用户的相册照片。pending 仅表示没有归档年份；query 只匹配已保存的讲述和备注，不是看图搜索。不要编造照片ID。',
    'photo.item.read': '用查询结果中的 photo_id 查看照片已有信息并展示整理卡片。不会调用看图模型或修改照片；用户可在卡片里继续讲述或确认分析。',
}


MODELS = {'photo.action': PhotoAction, 'diary.open': OpenDiary, 'diary.list': ListDiaries, 'diary.read': ReadDiary, 'memory.save': SaveMemory, 'memory.search': SearchMemories,
          'memory.list': ListMemories, 'memory.delete': DeleteMemory,
          'photo.album.list': ListPhotos, 'photo.item.read': ReadPhoto, 'photo.organize.start': OrganizePhotos, 'photo.organize.input': PhotoTaskCommand}


def tool_schemas():
    return [dict(name=name, parameters=model.model_json_schema(),
                 effect='workflow_start' if name in ('photo.organize.start', 'photo.organize.input') else 'proposal_only' if name in ('memory.save','memory.delete','photo.action') else 'read_only')
            for name, model in MODELS.items()]


def dispatch(store, owner, actor, name, arguments):
    if name not in MODELS:
        raise ValueError('Unknown companion tool')
    values = MODELS[name].model_validate(arguments).model_dump()
    if name == 'diary.open':
        return dict(diaries=[], open_calendar=True, spoken_text='日记入口已经打开，可以查看日历或选择一天写日记。')
    if name == 'diary.list':
        result = store.diaries(owner, actor, values['month'])
        return dict(result, open_calendar=False, spoken_text=f"这个月有{len(result['diaries'])}篇已保存日记。")
    if name == 'diary.read':
        entries = store.diaries(owner, actor, values['day'][:7])['diaries']
        entries = [entry for entry in entries if entry['day'] == values['day']]
        return dict(diaries=entries, open_calendar=False, spoken_text='找到这一天的日记了。' if entries else '这一天还没有保存的日记。')
    if name == 'memory.save':
        return store.prepare(owner, actor, 'save', values)
    if name == 'memory.delete':
        return store.prepare(owner, actor, 'delete', values)
    if name in ('photo.organize.start', 'photo.organize.input', 'photo.action'):
        raise ValueError('Workflow start requires a claimed chat turn')
    if name.startswith('photo.'):
        from .photo_tools import read_photos
        return read_photos(owner, name, values)
    return store.memories(owner, **values)
