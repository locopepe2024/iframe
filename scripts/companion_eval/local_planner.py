"""Synthetic, read-only live planner evaluation. No production chat or tools."""
import argparse
import json
from pathlib import Path
import time

from src.apps.companion_runtime.local_planner import propose_local, PlannerRejected


ACTIVE = {'type': 'image_edit', 'status': 'active', 'brief': '', 'photo_selected': False}
CASES = [
    ('start', '修改一张照片', {}, ['media.task.ensure', 'media.source.request'], None),
    ('combined', '修改照片，背景换成海边，人物不变，从相册选', {}, ['media.task.ensure', 'media.brief.set', 'media.source.request'], 'album'),
    ('brief_before_photo', '把背景换成海边，人物不变', {'active': ACTIVE}, ['media.brief.set', 'media.source.request'], 'ask'),
    ('album', '从相册里选', {'active': ACTIVE}, ['media.source.request'], 'album'),
    ('upload', '还是上传吧', {'active': ACTIVE}, ['media.source.request'], 'upload'),
    ('preserve', '再把背景换成海边', {'active': {**ACTIVE, 'brief': '人物不变', 'photo_selected': True}}, ['media.brief.set'], None),
    ('pause', '先不改了，聊会儿', {'active': ACTIVE}, ['media.task.pause'], None),
    ('cancel', '取消这次修图', {'active': ACTIVE}, ['media.task.cancel'], None),
    ('diary_focus', '今天我要修改一张照片', {'focus': 'diary_editor', 'draft': '今天测试功能'}, 'diary', None),
    ('diary_request', '把今天聊过的事情写成日记', {}, 'diary', None),
    ('album_count', '相册一共有多少照片', {}, 'album', None),
    ('chat', '今天女儿来看我了', {}, 'chat', None),
    ('analysis', '帮我看看这张照片里有什么', {'selected_photo': True}, 'image_analysis', None),
    ('video', '我想生成一段小狗奔跑的视频', {}, 'video', None),
    ('ambiguous', '处理一张照片', {}, 'clarify', None),
]


def assess(decision, expected, source):
    if isinstance(expected, str):
        return decision.get('kind') == 'clarify' if expected == 'clarify' else decision.get('kind') == 'delegate' and decision.get('capability') == expected
    steps = decision.get('steps', [])
    if decision.get('kind') != 'image_edit' or [s['tool'] for s in steps] != expected:
        return False
    if source and steps[-1].get('source') != source:
        return False
    brief = next((s['brief'] for s in steps if s['tool'] == 'media.brief.set'), None)
    if brief is not None and ('海边' not in brief or '不变' not in brief):
        return False
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=len(CASES))
    args = parser.parse_args()
    records = []
    for name, text, state, expected, source in CASES[:args.limit]:
        record = dict(name=name, input=text, state=state, expected=expected, source=source)
        start = time.monotonic()
        try:
            result = propose_local(args.url, text, state)
            record.update(result, valid=True, semantic_match=assess(result['decision'], expected, source))
        except PlannerRejected as exc:
            record.update(valid=False, semantic_match=False, error=type(exc).__name__,
                          detail=str(exc)[:240], proposal=exc.proposal, usage=exc.usage)
        except Exception as exc:
            record.update(valid=False, semantic_match=False, error=type(exc).__name__, detail=str(exc)[:240])
        record['seconds'] = round(time.monotonic()-start, 3)
        records.append(record)
        args.output.write_text(json.dumps(dict(scope='synthetic-read-only-no-execution', records=records), ensure_ascii=False, indent=2))
        print(json.dumps(record, ensure_ascii=False), flush=True)
    print(json.dumps(dict(total=len(records), valid=sum(r['valid'] for r in records), semantic_match=sum(r['semantic_match'] for r in records))), flush=True)


if __name__ == '__main__':
    main()
