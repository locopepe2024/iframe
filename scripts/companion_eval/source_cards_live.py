"""Real Qwen proposals against synthetic, temporary task state (no generation).

Run with the demo's existing environment and an explicitly named configured
validation identity. Credentials stay inside UserConfigStore; only synthetic
inputs and model proposals are included in the report.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import tempfile
import time

from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.model import propose
from src.apps.companion_runtime.tools import MODELS
from src.apps.identity import UserContext


STARTS = ['我们修改一张照片吧', '嗯，我要处理一张照片', '我想给一张照片换个背景',
          '帮我编辑一张图片', '我我想修改照片']
SOURCES = [('从相册里选', 'open_album'), ('用以前存的那张，打开相册', 'open_album'),
           ('还是上传吧', 'open_upload'), ('我要从手机上传照片', 'open_upload')]


def scenario(identity, index, repeat):
    start, (source, action) = STARTS[index // 4], SOURCES[index % 4]
    record = dict(case=index, repeat=repeat, checks=[], turns=[])
    with tempfile.TemporaryDirectory(prefix='companion-card-eval-') as folder:
        store = ChatStore(Path(folder) / 'chat.db', initialize=True)
        owner, actor = identity.owner_profile_id, identity.user_id
        session = store.session(owner, 'session')['session_id']
        def turn(text, operation):
            claim = store.claim_turn(owner, actor, session, operation, text)
            begun = time.monotonic()
            proposal = propose(identity, claim['messages'], claim['message_id'])
            # Record only synthetic scenario data. No credentials or real history.
            record['turns'].append(dict(input=text, proposal=proposal,
                                        seconds=round(time.monotonic()-begun, 3)))
            if proposal['kind'] == 'tool':
                MODELS[proposal['name']].model_validate(proposal['arguments'])
            return proposal, store.finish_turn(owner, actor, claim, proposal)['result']
        try:
            proposal, first = turn(start, 'start')
            record['checks'].append(first.get('kind') == 'media_draft' and first.get('type') == 'image_edit')
            record['checks'].append(first.get('brief') == '' and bool(first.get('ui_card')))
            if not all(record['checks']):
                record['passed'] = False
                return record
            proposal, chosen = turn(source, 'source')
            record['checks'].append(chosen.get('task_id') == first['task_id'] and chosen.get('ui_action') == action and chosen.get('brief') == '')
            proposal, brief = turn('把背景换成海边，人物保持不变', 'brief')
            record['checks'].append(proposal.get('name') == 'media.draft.update' and proposal.get('arguments', {}).get('action') == 'brief' and brief.get('task_id') == first['task_id'])
            record['checks'].append('海边' in brief.get('brief', '') and ('不变' in brief.get('brief', '') or '保留' in brief.get('brief', '')))
        except Exception as exc:
            # Exception text might originate upstream: report type only.
            record['error_type'] = type(exc).__name__
        record['passed'] = len(record['checks']) == 5 and all(record['checks'])
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--owner', required=True)
    parser.add_argument('--actor', required=True)
    parser.add_argument('--cases', type=int, default=20, choices=range(1,21))
    parser.add_argument('--repeats', type=int, default=3, choices=range(1,4))
    parser.add_argument('--workers', type=int, default=3, choices=range(1,5))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    identity = UserContext(args.actor, args.owner, '', '')
    records = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = [pool.submit(scenario, identity, i, r) for i in range(args.cases) for r in range(args.repeats)]
        for job in as_completed(jobs):
            record = job.result(); records.append(record)
            args.output.write_text(json.dumps(dict(scope='live-Qwen-synthetic-state-no-media-no-generation', records=records), ensure_ascii=False, indent=2))
            print(json.dumps(dict(case=record['case'], repeat=record['repeat'], passed=record['passed'],
                                  checks=record['checks'], error_type=record.get('error_type')), ensure_ascii=False), flush=True)
    print(json.dumps(dict(total=len(records), passed=sum(r['passed'] for r in records))), flush=True)


if __name__ == '__main__':
    main()
