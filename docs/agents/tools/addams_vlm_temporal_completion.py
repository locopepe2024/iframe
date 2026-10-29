"""One temporal semantic completion probe with a declared anatomical identity anchor."""
import argparse
import base64
import hashlib
import json
import os
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from addams_vlm_stream_probe import ROOT, FRAMES, receive, save

TARGETS = [47, 49, 53, 58, 62, 64]
PROMPT = '''这些是同一视频源第46至65帧的连续原RGB，25fps，PTS=(帧号-1)/25。任务是构造可供动画师复核的连续动作解释，不要求逐像素还原遮挡关节。
唯一人工身份锚点：第49帧人物解剖左脚在图像归一化坐标约(0.33,0.62)，右脚约(0.71,0.96)。这是已有人工脚部位置标注，只用于辨别身份；其他帧没有给你动作或接触答案。向前后追踪，不按画面左右重新命名；如果证据与锚点冲突，明确报告，不能编造身份连续性。
对模糊帧利用前后可见腿的轨迹、身体位移和步态阶段补全语义。分开直接观察与时序推断。允许提出合理动作候选，但不能把常见步态当成已观察事实；近地单帧不自动证明接触。区分人物转向、相机运动与切镜，证据不足用unknown。
只返回紧凑JSON，不要长篇推理。字段：
summary:字符串；
phases:最多5项，每项start_frame,end_frame,action,observation,inference,certainty(high/medium/low)；
frame_states:恰好47/49/53/58/62/64六项，每项source_frame,left_contact和right_contact(只能contact/airborne/unknown),left_leg_phase,right_leg_phase,identity_basis(anchor/tracked/unknown),evidence_frame_ids(实际提交帧号),observation,inference,certainty(high/medium/low)；
shot_boundaries:数组，每项between_frames(两个相邻提交帧号),observation；不确定不填写确定切镜；
uncertainties:字符串数组。
不要输出3D坐标、精确焦距或IK指令，不补全外貌。总正文尽量不超过1200中文字。'''


def validate(data):
    errors = []
    if not isinstance(data, dict):
        return ['root_not_object']
    for key in ['summary', 'phases', 'frame_states', 'shot_boundaries', 'uncertainties']:
        if key not in data:
            errors.append('missing_' + key)
    states = data.get('frame_states')
    if not isinstance(states, list) or any(not isinstance(s, dict) for s in states):
        return errors + ['invalid_frame_states']
    if sorted(s.get('source_frame', -1) for s in states) != TARGETS:
        errors.append('target_coverage')
    for state in states:
        for side in ['left', 'right']:
            if state.get(side + '_contact') not in ['contact', 'airborne', 'unknown']:
                errors.append('contact_enum')
        if state.get('identity_basis') not in ['anchor', 'tracked', 'unknown']:
            errors.append('identity_basis')
        evidence = state.get('evidence_frame_ids')
        if not isinstance(evidence, list) or not evidence or any(type(x) is not int or x not in range(46, 66) for x in evidence):
            errors.append('evidence_frames')
        if state.get('certainty') not in ['high', 'medium', 'low']:
            errors.append('certainty')
        for key in ['observation', 'inference', 'left_leg_phase', 'right_leg_phase']:
            if not isinstance(state.get(key), str):
                errors.append('invalid_' + key)
    for phase in data.get('phases', []):
        a, b = phase.get('start_frame'), phase.get('end_frame')
        if type(a) is not int or type(b) is not int or not 46 <= a <= b <= 65:
            errors.append('phase_bounds')
    for cut in data.get('shot_boundaries', []):
        ids = cut.get('between_frames')
        if not isinstance(ids, list) or len(ids) != 2 or any(type(x) is not int for x in ids) or not 46 <= ids[0] < ids[1] <= 65 or ids[1] - ids[0] != 1:
            errors.append('cut_bounds')
    return errors


def evaluate(data):
    # Read held-out human contact labels only after response freezing.
    path = ROOT / 'docs/agents/raw/2026-10-28-motion-asset-package/addams-segment-review-v1/event-reviewed.json'
    gold = {r['source_frame']: r['contact'] for r in json.loads(path.read_text())['frames']}
    rows = []
    for state in data['frame_states']:
        sf = state['source_frame']
        if sf == 49 or sf not in gold:
            continue  # Anchor frame excluded; location itself exposes near-ground foot.
        left, right = state['left_contact'], state['right_contact']
        pred = ('unknown' if 'unknown' in [left, right] else 'both' if left == right == 'contact'
                else 'left' if left == 'contact' else 'right' if right == 'contact' else 'airborne')
        rows.append({'source_frame': sf, 'human_support': gold[sf], 'predicted_support': pred,
                     'answered': pred != 'unknown', 'match': pred == gold[sf]})
    n = len(rows)
    answered = sum(r['answered'] for r in rows)
    correct = sum(r['match'] for r in rows)
    return {'rows': rows, 'anchor_frame_excluded': 49, 'comparable_frames': n,
            'answer_coverage': answered / n if n else None,
            'all_label_agreement': correct / n if n else None,
            'answered_agreement': correct / answered if answered else None,
            'limits': ['Existing labels may contain errors; disagreement needs visual review.',
                       'No causal isolation: both context and anchor changed from previous probe.',
                       'Same-clip tiny sample, no 3D or contact-timing validation.']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    content = [{'type': 'text', 'text': PROMPT}]
    evidence = []
    for frame in range(46, 66):
        raw = (FRAMES / f'frame-{frame:03}.jpg').read_bytes()
        evidence.append({'source_frame': frame, 'pts_s': (frame - 1) / 25,
                         'sha256': hashlib.sha256(raw).hexdigest()})
        content.extend([{'type': 'text', 'text': f'SOURCE_FRAME={frame}, PTS={(frame-1)/25:.2f}s'},
                        {'type': 'image_url', 'image_url': {
                            'url': 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()}}])
    anchor_path = ROOT / 'docs/agents/raw/2026-10-29-addams-native-layered-v1/shoe-proxy-review/accepted.json'
    anchor_bytes = anchor_path.read_bytes()
    anchor = next(r for r in json.loads(anchor_bytes)['frames'] if r['source_frame'] == 49)
    assert abs(anchor['points']['left_forefoot']['x'] - .33) < .02
    assert abs(anchor['points']['right_forefoot']['x'] - .71) < .02
    manifest = {'model_requested': 'qwen3.8-flash', 'submitted_frames': evidence,
                'identity_anchor_frame': 49, 'anchor_file_sha256': hashlib.sha256(anchor_bytes).hexdigest(),
                'human_contact_labels_in_prompt': False, 'production_writes': False,
                'requested_max_tokens': 2500, 'max_tokens_billing_limit_verified': False,
                'call_limit': 1, 'automatic_retries': 0}
    save(args.output / 'manifest.json', manifest)
    (args.output / 'prompt.txt').write_text(PROMPT)
    if not args.run:
        return
    load_dotenv(ROOT / '.env')
    headers = {'Authorization': 'Bearer ' + os.environ['UNIART_API_KEY'],
               'X-Client-Request-Id': str(uuid.uuid4()), 'Accept': 'text/event-stream'}
    payload = {'model': manifest['model_requested'], 'messages': [{'role': 'user', 'content': content}],
               'stream': True, 'stream_options': {'include_usage': True}, 'temperature': 0, 'max_tokens': 2500}
    with httpx.Client(timeout=httpx.Timeout(connect=30, read=600, write=120, pool=30)) as client:
        trace = receive(client, os.getenv('UNIART_BASE_URL', 'https://uniart.fun/v1').rstrip('/') + '/chat/completions', headers, payload, args.output)
    result = {'transport_complete': trace['client_response_status'] == 'complete', 'semantic_accuracy': 'not_established'}
    if result['transport_complete']:
        try:
            body = (args.output / 'response.txt').read_text().strip()
            if body.startswith('```'):
                body = body.split('\n', 1)[1].rsplit('```', 1)[0]
            data = json.loads(body)
            save(args.output / 'parsed.json', data)
            errors = validate(data)
            result.update(errors=errors, format_pass=not errors)
            if not errors:
                save(args.output / 'evaluation.json', evaluate(data))
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            result.update(format_pass=False, error_type=type(exc).__name__)
    save(args.output / 'validation.json', result)
    print(json.dumps({'transport': trace, 'validation': result}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
