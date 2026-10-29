"""Strict memory and read-only photo tool boundary. Model-facing writes only return confirmation drafts."""
from typing import Literal
from datetime import date, datetime
from zoneinfo import ZoneInfo
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


class StartMediaDraft(Strict):
    type: Literal['image_edit', 'image_generate', 'video_generate']
    video_mode: Literal['t2v', 'i2v', 'f2v', 'r2v'] | None = None
    brief: str = Field(default='', max_length=4000)


class UpdateMediaDraft(Strict):
    task_id: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=1)
    action: Literal['open_upload', 'open_album', 'brief', 'select_photo', 'select_first_photo', 'select_last_photo', 'add_reference_photo', 'remove_reference_photo', 'video_mode', 'clear_photo', 'setting', 'pause', 'resume', 'cancel']
    setting: str | None = Field(default=None, max_length=40)
    brief: str = Field(default='', max_length=4000)
    photo_id: str | None = Field(default=None, max_length=120)


class OpenDiary(Strict):
    pass


class SaveDiaryDraft(Strict):
    source_turn_id: str = Field(min_length=1, max_length=120)
    day: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')

    @field_validator('day')
    @classmethod
    def valid_day(cls, value):
        if value is not None:
            date.fromisoformat(value)
        return value


class ListDiaries(Strict):
    month: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}$')

    @field_validator('month')
    @classmethod
    def valid_month(cls, value):
        if value is not None:
            date.fromisoformat(value + '-01')
        return value


class ReadDiary(Strict):
    day: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')

    @field_validator('day')
    @classmethod
    def valid_day(cls, value):
        date.fromisoformat(value)
        return value


class CountPhotos(Strict):
    pass


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
    dict(name='creative', description='通过对话准备修改照片、生成图片或视频的任务卡片，不提交生成。', tools=['media.draft.start', 'media.draft.update']),
    dict(name='album', description='统计相册照片总数、打开和查询站内相册、查看照片、发起与继续整理工作流；分析及修改需用户确认。', tools=['photo.album.count', 'photo.album.list', 'photo.item.read', 'photo.organize.start', 'photo.organize.input', 'photo.action']),
    dict(name='diary', description='打开日记月历、查询已保存日记；用户明确说保存时可保存当前会话已生成且未修改的日记草稿。覆盖或编辑由编辑器核对。', tools=['diary.save_draft', 'diary.open', 'diary.list', 'diary.read']),
    dict(name='memory', description='查询个人记忆；保存、删除需用户确认。', tools=['memory.save', 'memory.search', 'memory.list', 'memory.delete']),
]


DESCRIPTIONS = {
    'media.draft.start': '开始修改照片(image_edit)、生成图片(image_generate)或视频(video_generate)任务卡片，不生成或计费。仅表达操作意图时brief留空，不把启动句当描述。有具体画面要求才提炼brief，不擅自补充。已有active_media_draft时，同类型继续用update；用户明确改口切换类型可start，服务端保留并暂停旧草稿。相册姓名日期修改不属于画面编辑。',
    'media.draft.update': '继续active_media_draft任务，task_id和expected_revision取服务端当前快照。用户选择上传来源时用open_upload，返回待点击选择文件的上传卡片，不代表已上传；用户选择已有相册用open_album，打开当前任务的选图界面。它们都是继续当前任务，不另开任务，不把选择来源的话写入brief。brief动作替换完整要求，保留此前未修改约束；只用具体创作内容，不加闲聊。select_photo只能取真实已选照片ID。pause保留并回聊天，resume恢复，cancel取消。不会提交生成或收费。',
    'diary.save_draft': '仅当用户明确要求保存已经看过的日记草稿时调用。从本会话 assistant_reply.turn_id 取得对应日记生成结果的 source_turn_id，不传正文、不生成新正文、不猜ID。多轮对话写成的日记也支持：day必须填写用户明确确定的YYYY-MM-DD日期，source_turn_id指向实际日记正文，不是提问、闲聊或保存说明。年份用明确会话时间，不从照片推断，不清楚先问。不用于用户只是提到日记或要求继续写。标准写作请求的日期由服务端核对；多轮写作日期由上下文确定，正文始终从源记录读取；当天已有其他版本或编辑器内容变动会提示核对，绝不静默覆盖。没有明确可保存的草稿时只问用户要保存哪篇。',
    'photo.album.count': '查询当前用户相册的实际照片总数，排除已删除照片。用户问一共有多少张、相册总共多少照片等数量问题时调用；直接返回统计，不询问整理范围，不打开相册，不从分页照片或聊天记录猜数量。无参数。只支持全相册总数；若明确询问某日期或人物的数量，此工具不支持筛选，不能把全库总数当成筛选数量。',
    'photo.action': '对当前选中的照片请求分析、修改资料或删除。只生成待确认卡片，不声称已完成。action=analyze需要用户确认外部看图；edit的changes仅填写用户明确说出的people、scene、lighting、location、latitude、longitude、capture_time、notes，未修改字段不传；姓名/年龄不得猜。delete必须确认。photo_id只可从工作流状态取得；没有选中照片先请用户选择。',
    'diary.open': '用户要求打开日历、日记、查看日记本时直接打开日记月历。不保存或生成日记。',
    'diary.list': '用户问哪些天写过日记、查看某月日记时，按 YYYY-MM 月份打开日记月历，以日期标记展示，不展开正文。未指定月份时省略month，服务端默认本月，不要追问月份；只有明确阅读某一天才用diary.read。不要用记忆搜索代替日记查询。',
    'diary.read': '按明确的 YYYY-MM-DD 日期阅读当前用户已保存的日记，并展示可编辑的日记卡片。不修改或编造正文。',

    'photo.organize.input': '继续当前会话的相册任务。依据 workflow_tasks 的 task_id、revision 和按顺序排列的候选照片ID选择照片，或明确结束、取消。仅在用户明确要求时操作；有歧义先问清楚。',
    'photo.organize.start': '先询问时间或人物范围；泛泛要求整理相册时不要无条件查询。明确范围后发起可恢复的相册整理工作流，先查询照片并等待用户选择。date_prefix 可用 YYYY、YYYY-MM、YYYY-MM-DD；query 使用空格分隔关键词，匹配最新用户资料、讲述及核对描述，每个词均须匹配。不能猜测亲属。没有日期用 pending。不会自动分析或保存修改。',
    'photo.album.list': '浏览、查找照片使用同一工具。用户明确要求看全部照片时，不必询问时间或人物，以view=all、空query查询，仍按limit分页，不能一次读取全库。浏览不等于整理，不调用photo.organize.start。文字和语音查找照片使用同一工具。将明确年份放 year，年月日放 date_prefix（YYYY、YYYY-MM、YYYY-MM-DD）；人物、地点、场景、光影、故事关键词放 query，以空格分隔且每个词必须匹配。例如找2025年女儿在海边的照片：year=2025, query="女儿 海边"。仅搜索最新用户填写资料、讲述和已核对描述，不搜索未核对的AI观察，不推断姓名或亲属，不把整句指令当关键词。相对日期须依据明确的会话日期，不清楚只问一个问题。pending 表示无归档日期。零结果如实告知，可建议减少条件，不能擅自展示全库或声称照片不存在。保留筛选条件翻页，不编造照片ID。',
    'photo.item.read': '用查询结果中的 photo_id 查看照片已有信息并展示整理卡片。不会调用看图模型或修改照片；用户可在卡片里继续讲述或确认分析。',
}


MODELS = {'media.draft.start': StartMediaDraft, 'media.draft.update': UpdateMediaDraft, 'diary.save_draft': SaveDiaryDraft, 'photo.action': PhotoAction, 'diary.open': OpenDiary, 'diary.list': ListDiaries, 'diary.read': ReadDiary, 'memory.save': SaveMemory, 'memory.search': SearchMemories,
          'memory.list': ListMemories, 'memory.delete': DeleteMemory,
          'photo.album.count': CountPhotos, 'photo.album.list': ListPhotos, 'photo.item.read': ReadPhoto, 'photo.organize.start': OrganizePhotos, 'photo.organize.input': PhotoTaskCommand}


def tool_schemas():
    return [dict(name=name, parameters=model.model_json_schema(),
                 effect='draft_update' if name.startswith('media.draft.') else 'explicit_save' if name == 'diary.save_draft' else 'workflow_start' if name in ('photo.organize.start', 'photo.organize.input') else 'proposal_only' if name in ('memory.save','memory.delete','photo.action') else 'read_only')
            for name, model in MODELS.items()]


def dispatch(store, owner, actor, name, arguments):
    if name not in MODELS:
        raise ValueError('Unknown companion tool')
    values = MODELS[name].model_validate(arguments).model_dump()
    if name.startswith('media.draft.'):
        raise ValueError('Creative draft requires a claimed turn or session-scoped operation')
    if name == 'diary.save_draft':
        raise ValueError('Diary save requires a claimed chat turn')
    if name == 'diary.open':
        return dict(diaries=[], open_calendar=True, spoken_text='日记入口已经打开，可以查看日历或选择一天写日记。')
    if name == 'diary.list':
        month = values['month'] or datetime.now(ZoneInfo('Asia/Hong_Kong')).strftime('%Y-%m')
        result = store.diaries(owner, actor, month)
        return dict(diaries=[], days=[entry['day'] for entry in result['diaries']], month=month, open_calendar=True, spoken_text=f"这个月有{len(result['diaries'])}篇已保存日记，已在月历标出。")
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
