"""Read-only synthetic host-model gate. Never loads user data or executes tools."""
import argparse
import json
import time

from src.apps.companion_runtime.local_planner import propose_local

ACTIVE = dict(type='image_edit', status='active', photo_id=None, brief='人物保持不变')
CASES = [
    ('start', '修改一张照片', {}, 'image_edit', ['media.task.ensure','media.source.request'], 'ask'),
    ('compound', '修改照片，把背景换成海边，人物不变，从相册选', {}, 'image_edit', ['media.task.ensure','media.brief.set','media.source.request'], 'album'),
    ('upload', '上传', {'active':ACTIVE}, 'image_edit', ['media.source.request'], 'upload'),
    ('brief', '把衣服改成黑色长袍', {'active':ACTIVE}, 'image_edit', ['media.brief.set','media.source.request'], 'ask'),
    ('pause', '先不改了，聊聊天', {'active':ACTIVE}, 'image_edit', ['media.task.pause'], None),
    ('resume', '继续之前没有完成的任务', {'paused':[dict(ACTIVE,status='paused')]}, 'image_edit', ['media.task.resume','media.source.request'], 'ask'),
    ('count', '相册一共有多少张照片', {}, 'delegate', [], None),
    ('chat', '今天女儿来看我了', {}, 'delegate', [], None),
    ('diary', '写一下今天的日记', {}, 'delegate', [], None),
    ('ambiguous', '帮我处理一张照片', {}, 'clarify', [], None),
]


def assess(name, decision, kind, tools, source):
    if decision['kind'] != kind:
        return False
    steps = decision.get('steps', [])
    if [step['tool'] for step in steps] != tools:
        return False
    if source and steps[-1].get('source') != source:
        return False
    brief = next((step.get('brief','') for step in steps if step['tool']=='media.brief.set'), '')
    if name == 'compound' and not ('海边' in brief and '人物' in brief and '不变' in brief):
        return False
    if name == 'brief' and not ('黑' in brief and '长袍' in brief and '人物' in brief and '不变' in brief):
        return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--repeat', type=int, default=1)
    args = parser.parse_args()
    passed = total = 0
    for iteration in range(args.repeat):
        for name,text,state,kind,tools,source in CASES:
            start = time.monotonic()
            record = dict(case=name, iteration=iteration, passed=False)
            try:
                result = propose_local(args.url,text,state,timeout=25)
                record.update(decision=result['decision'], passed=assess(name,result['decision'],kind,tools,source))
            except Exception as exc:
                record.update(error=type(exc).__name__)
            record['seconds'] = round(time.monotonic()-start,2)
            total += 1
            passed += int(record['passed'])
            print(json.dumps(record,ensure_ascii=False),flush=True)
    print(json.dumps(dict(passed=passed,total=total)),flush=True)


if __name__ == '__main__':
    main()
