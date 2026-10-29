"""Registered source-choice UI. Models supply copy, never executable actions."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceChoiceCopy(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: str = Field(default='想修改哪张照片？', min_length=1, max_length=60)


SOURCE_ACTIONS = {'upload': 'open_upload', 'album': 'open_album', 'back': 'pause'}
UI_CATALOG = {
    'protocol': 'companion.ui.v1',
    'components': [{
        'name': 'choice_card',
        'purpose': '图片编辑缺少素材时选择来源；动作由服务端绑定，模型只提供标题。',
        'copy_schema': SourceChoiceCopy.model_json_schema(),
        'options': list(SOURCE_ACTIONS),
    }],
}


def source_card(task):
    if task['status'] != 'active' or task['type'] != 'image_edit' or task['photo_id']:
        return None
    copy = SourceChoiceCopy.model_validate(task.get('source_choice') or {})
    return dict(protocol='companion.ui.v1', component='choice_card',
                card_id=f"{task['task_id']}:{task['revision']}:source",
                task=dict(id=task['task_id'], revision=task['revision']), status='active',
                props=dict(title=copy.title, options=[
                    dict(id='upload', label='上传照片', action='media.open_upload'),
                    dict(id='album', label='从相册选择', action='media.open_album'),
                    dict(id='back', label='返回聊天', action='media.pause')]),
                spoken_text=copy.title + '可以上传，也可以从相册选。')


def resolve_source(task, card_id, option_id):
    card = source_card(task)
    if not card or card['card_id'] != card_id or option_id not in SOURCE_ACTIONS:
        raise ValueError('Source card is unavailable or action is not registered')
    return SOURCE_ACTIONS[option_id]
