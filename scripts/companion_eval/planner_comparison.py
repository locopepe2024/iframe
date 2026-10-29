"""Read-only 2x2 protocol/grammar comparison on identical synthetic cases."""
import argparse
import json
import time
from pathlib import Path

import requests
from pydantic import Field
from typing import Literal
from src.apps.companion_runtime.local_planner import Strict, Proposal, SYSTEM, check
from scripts.companion_eval.local_planner import CASES, assess


class Intent(Strict):
    intent: Literal['edit', 'pause', 'cancel', 'clarify', 'chat', 'diary', 'album', 'image_analysis', 'video']
    brief: str = Field(max_length=1000)
    source: Literal['none', 'ask', 'album', 'upload']


INTENT_SYSTEM = """你是小安的意图提取器，只输出JSON，不执行任务。
字段intent: edit修改图片、pause暂停修改、cancel取消修改、clarify澄清、chat闲聊、diary日记、album相册浏览或计数、image_analysis看图描述、video视频生成。
brief只填具体画面修改要求；保留state.active.brief未撤销约束；没有要求填空。修改一张照片不是画面要求。
source为album从相册选、upload上传、ask未选来源、none不涉及选图。edit缺图且未指定来源则ask；已选图则none。其他意图source=none且brief为空。
focus=diary_editor时讲照片也是日记内容，intent=diary。处理照片未说明如何处理时clarify。
示例：修改一张照片 -> {"intent":"edit","brief":"","source":"ask"}
从相册选（已有编辑任务） -> {"intent":"edit","brief":"","source":"album"}
取消这次修图 -> {"intent":"cancel","brief":"","source":"none"}
今天女儿来看我了 -> {"intent":"chat","brief":"","source":"none"}"""


def expand(value, state):
    """Expand dependency steps from state only; never infer intent from text."""
    value = Intent.model_validate(value)
    if value.intent != 'edit' and (value.brief or value.source != 'none'):
        raise ValueError('Parameters outside edit intent')
    if value.intent in ('pause', 'cancel'):
        decision = {'kind': 'image_edit', 'steps': [{'tool': 'media.task.' + value.intent}]}
    elif value.intent == 'edit':
        steps = []
        active = state.get('active', {})
        if not (active.get('type') == 'image_edit' and active.get('status') == 'active'):
            steps.append({'tool': 'media.task.ensure'})
        if value.brief:
            steps.append({'tool': 'media.brief.set', 'brief': value.brief})
        if value.source != 'none':
            steps.append({'tool': 'media.source.request', 'source': value.source})
        decision = {'kind': 'image_edit', 'steps': steps}
    elif value.intent == 'clarify':
        decision = {'kind': 'clarify', 'question': '请说明希望如何处理照片。'}
    else:
        decision = {'kind': 'delegate', 'capability': value.intent}
    return check({'decision': decision}, state).model_dump()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records = []
    for protocol, schema, system in [('steps', Proposal, SYSTEM), ('intent', Intent, INTENT_SYSTEM)]:
        for grammar in (True, False):
            for name, text, state, expected, source in CASES:
                record = dict(protocol=protocol, grammar=grammar, name=name, valid=False, semantic_match=False)
                start = time.monotonic()
                try:
                    body = dict(messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': json.dumps({'input': text, 'state': state}, ensure_ascii=False)}], temperature=0, max_tokens=320)
                    if grammar:
                        body['response_format'] = {'type': 'json_object', 'schema': schema.model_json_schema()}
                    response = requests.post(args.url, json=body, timeout=(2, 30))
                    response.raise_for_status()
                    payload = response.json()
                    choice = payload['choices'][0]
                    raw = choice['message']['content']
                    record.update(raw=raw, usage=payload.get('usage'), finish_reason=choice.get('finish_reason'), model=payload.get('model'))
                    if choice.get('finish_reason') != 'stop':
                        raise ValueError('Incomplete output')
                    value = json.loads(raw)
                    decision = expand(value, state) if protocol == 'intent' else check(value, state).model_dump()
                    record.update(decision=decision, valid=True, semantic_match=assess(decision, expected, source))
                except Exception as exc:
                    record.update(error=type(exc).__name__, detail=str(exc)[:240])
                record['seconds'] = round(time.monotonic() - start, 3)
                records.append(record)
                args.output.write_text(json.dumps({'scope': 'synthetic-read-only-no-execution', 'records': records}, ensure_ascii=False, indent=2))
            group = [r for r in records if r['protocol'] == protocol and r['grammar'] == grammar]
            print(json.dumps(dict(protocol=protocol, grammar=grammar, total=len(group), valid=sum(r['valid'] for r in group), semantic_match=sum(r['semantic_match'] for r in group))), flush=True)


if __name__ == '__main__':
    main()
