"""Isolated CPU planner experiment. Proposals only: never executes tools."""
import json
from typing import Annotated, Literal

import requests
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Ensure(Strict):
    tool: Literal['media.task.ensure']


class Brief(Strict):
    tool: Literal['media.brief.set']
    brief: str = Field(min_length=1, max_length=1000)


class Source(Strict):
    tool: Literal['media.source.request']
    source: Literal['ask', 'album', 'upload']


class Pause(Strict):
    tool: Literal['media.task.pause']


class Resume(Strict):
    tool: Literal['media.task.resume']


class Cancel(Strict):
    tool: Literal['media.task.cancel']


Step = Annotated[Ensure | Brief | Source | Pause | Cancel | Resume, Field(discriminator='tool')]


class EditPlan(Strict):
    kind: Literal['image_edit']
    steps: list[Step] = Field(min_length=1, max_length=4)

    @model_validator(mode='after')
    def ordered(self):
        names = [step.tool for step in self.steps]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate tool in bounded plan')
        if 'media.task.ensure' in names and names[0] != 'media.task.ensure':
            raise ValueError('Ensure must be first')
        if 'media.task.resume' in names and names[0] != 'media.task.resume':
            raise ValueError('Resume must be first')
        if 'media.source.request' in names and names[-1] != 'media.source.request':
            raise ValueError('User wait must be last')
        if any(n in names for n in ('media.task.pause', 'media.task.cancel')) and len(names) != 1:
            raise ValueError('Pause/cancel cannot combine with other writes')
        return self


class Clarify(Strict):
    kind: Literal['clarify']
    question: str = Field(min_length=1, max_length=150)


class Delegate(Strict):
    kind: Literal['delegate']
    capability: Literal['chat', 'diary', 'album', 'image_analysis', 'video']


class Proposal(Strict):
    decision: Annotated[EditPlan | Clarify | Delegate, Field(discriminator='kind')]


SYSTEM = '''你是小安的主机任务编排器，只输出指定JSON，不执行任务、不回复聊天内容。
图片画面编辑用image_edit。处理照片有歧义时clarify。普通聊天/日记/相册浏览/看图分析/视频用delegate，不假装完成。
steps按序执行：media.task.ensure取得图片编辑任务；media.brief.set保存完整修改要求；media.source.request请求选图，source为ask/album/upload；media.task.pause暂停；media.task.cancel取消；media.task.resume恢复唯一暂停任务，先resume再补要求或选来源。
paused为暂停任务列表，无active且只有一个paused时明确继续才resume，不ensure。多个暂停任务需clarify，不能猜。
已有active任务不必ensure；没有则先ensure。没有选图也先保存明确要求。只说修改照片不是画面要求，不能写进brief。选择来源不是brief。保存要求时保留旧brief中未被用户撤销的约束。
缺少照片且没有其他明确来源时，最后source=ask；明确选择相册/上传时source=album/upload。已选图则不重复询问来源。只输出注册步骤，不编造素材或任务ID。
focus=diary_editor时，用户讲照片或视频也是日记内容，除非明确要求离开编辑；不明确时问清。
输出格式示例（选择符合用户请求的一种，不照抄内容）：
新编辑任务：{"decision":{"kind":"image_edit","steps":[{"tool":"media.task.ensure"},{"tool":"media.source.request","source":"ask"}]}}
已有任务补充要求：{"decision":{"kind":"image_edit","steps":[{"tool":"media.brief.set","brief":"调亮，人物不变"},{"tool":"media.source.request","source":"ask"}]}}
暂停：{"decision":{"kind":"image_edit","steps":[{"tool":"media.task.pause"}]}}
澄清：{"decision":{"kind":"clarify","question":"想修改画面，还是整理资料？"}}
交给聊天：{"decision":{"kind":"delegate","capability":"chat"}}
steps中一个工具至多一次；source步骤至多一个且排最后。'''


class PlannerRejected(ValueError):
    """Keep synthetic proposal/usage for evaluation without executing it."""
    def __init__(self, reason, *, proposal, usage):
        super().__init__(reason)
        self.proposal = proposal
        self.usage = usage


def check(proposal, state):
    """Validate state prerequisites without changing any task state."""
    decision = Proposal.model_validate(proposal).decision
    if isinstance(decision, EditPlan):
        active = state.get('active')
        editing = state.get('focus') in ('diary_editor', 'photo_editor')
        if editing:
            raise ValueError('Return from diary editor before a media plan')
        available = bool(active and active.get('status') == 'active' and active.get('type') == 'image_edit')
        for step in decision.steps:
            if isinstance(step, Resume):
                paused = state.get('paused', [])
                if active or len(paused) != 1 or paused[0].get('type') != 'image_edit':
                    raise ValueError('Resume requires a single paused image editing task')
                available = True
            elif isinstance(step, Ensure):
                if active and not available:
                    raise ValueError('Explicit lane switching is outside this experiment')
                available = True
            elif not available:
                raise ValueError('No active image editing task')
    return decision


def propose_local(url, text, state, *, timeout=30):
    """Explicit internal endpoint only, configured by the evaluation caller."""
    if not text.strip() or len(text) > 1200 or len(json.dumps(state)) > 6000:
        raise ValueError('Planner input exceeds experiment budget')
    response = requests.post(url, json={
        'messages': [{'role': 'system', 'content': SYSTEM},
                     {'role': 'user', 'content': json.dumps({'input': text, 'state': state}, ensure_ascii=False)}],
        'temperature': 0, 'max_tokens': 320,
        'response_format': {'type': 'json_object', 'schema': Proposal.model_json_schema()},
    }, timeout=(2, timeout))
    response.raise_for_status()
    payload = response.json()
    message = payload['choices'][0]
    if message.get('finish_reason') != 'stop':
        raise ValueError('Planner output is incomplete')
    proposal = json.loads(message['message']['content'])
    try:
        decision = check(proposal, state)
    except ValueError as exc:
        raise PlannerRejected(str(exc), proposal=proposal, usage=payload.get('usage', {})) from exc
    return dict(decision=decision.model_dump(), usage=payload.get('usage', {}),
                model=payload.get('model'), timings=payload.get('timings', {}))
