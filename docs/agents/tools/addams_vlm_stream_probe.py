"""One bounded source-only diagnostic; persist SSE before parsing, never retry."""
import argparse
import base64
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
FRAMES = ROOT / 'docs/agents/raw/2026-10-29-addams-vlm-phase-test-v1/dense'
PROMPT = '''按时间顺序分析源第47、49、53帧（25fps，PTS=(帧号-1)/25），仅主角。输出简短JSON：summary、frame_states、uncertainties。frame_states每项：source_frame、body_orientation、action_phase、left_contact、right_contact、visible_evidence。contact只用contact/airborne/unknown；左右按人物解剖左右，不确定写unknown。区分可见事实与解释，单帧近地不证明接触。不要推断精确3D、焦距、IK，也不精确定位未提供帧的事件。总输出尽量少于600中文字。'''


def save(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def receive(client, url, headers, payload, out):
    start = time.monotonic()
    trace = {'client_request_id': headers['X-Client-Request-Id'],
             'started_utc': datetime.now(timezone.utc).isoformat(),
             'client_response_status': 'awaiting_headers', 'upstream_status': 'unknown',
             'automatic_retries': 0, 'stream_done': False, 'chunks': 0}
    trace_path = out / 'transport.json'
    save(trace_path, trace)
    try:
        with client.stream('POST', url, headers=headers, json=payload) as response:
            trace.update(headers_elapsed_s=round(time.monotonic() - start, 3),
                         status_code=response.status_code,
                         response_ids={k: response.headers[k] for k in
                                       ['x-request-id', 'request-id', 'cf-ray'] if k in response.headers},
                         client_response_status='receiving')
            save(trace_path, trace)
            response.raise_for_status()
            pending = []
            with (out / 'events.sse').open('w') as raw, (out / 'response.txt').open('w') as text:
                for line in response.iter_lines():
                    raw.write(line + '\n')
                    raw.flush()
                    os.fsync(raw.fileno())
                    if 'first_line_elapsed_s' not in trace:
                        trace['first_line_elapsed_s'] = round(time.monotonic() - start, 3)
                    if line.startswith('data:'):
                        pending.append(line[5:].lstrip(' '))
                    if line or not pending:
                        continue
                    data = '\n'.join(pending)
                    pending = []
                    if data == '[DONE]':
                        trace['stream_done'] = True
                        break
                    event = json.loads(data)
                    if event.get('error'):
                        raise RuntimeError('SSEErrorEvent')
                    trace['chunks'] += 1
                    for key in ['id', 'model', 'usage']:
                        if event.get(key) is not None:
                            trace[key] = event[key]
                    for choice in event.get('choices', []):
                        if choice.get('index', 0) != 0:
                            continue
                        fragment = choice.get('delta', {}).get('content') or ''
                        if fragment:
                            if 'first_content_elapsed_s' not in trace:
                                trace['first_content_elapsed_s'] = round(time.monotonic() - start, 3)
                            text.write(fragment)
                            text.flush()
                            os.fsync(text.fileno())
                        if choice.get('finish_reason'):
                            trace['finish_reason'] = choice['finish_reason']
                    save(trace_path, trace)
            trace['client_response_status'] = (
                'complete' if trace['stream_done'] and trace.get('finish_reason') == 'stop'
                else 'incomplete')
    except Exception as exc:
        causes = []
        current = exc
        while current is not None:
            causes.append(type(current).__name__)
            current = current.__cause__
        trace.update(client_response_status='interrupted', error_cause_types=causes)
    finally:
        trace['elapsed_s'] = round(time.monotonic() - start, 3)
        save(trace_path, trace)
    return trace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    content = [{'type': 'text', 'text': PROMPT}]
    evidence = []
    for frame in [47, 49, 53]:
        path = FRAMES / f'frame-{frame:03}.jpg'
        raw = path.read_bytes()
        evidence.append({'source_frame': frame, 'pts_s': (frame - 1) / 25,
                         'sha256': hashlib.sha256(raw).hexdigest()})
        content.extend([{'type': 'text', 'text': f'SOURCE_FRAME={frame}'},
                        {'type': 'image_url', 'image_url': {
                            'url': 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()}}])
    payload = {'model': 'qwen3.8-flash', 'messages': [{'role': 'user', 'content': content}],
               'stream': True, 'stream_options': {'include_usage': True},
               'temperature': 0, 'max_tokens': 1800}
    save(args.output / 'manifest.json', {'model_requested': payload['model'],
         'submitted_frames': evidence, 'max_tokens': 1800, 'stream': True,
         'timeout_seconds': {'connect': 30, 'read_inactivity': 600, 'write': 120, 'pool': 30},
         'human_labels_in_prompt': False, 'semantic_accuracy': 'not_established'})
    (args.output / 'prompt.txt').write_text(PROMPT)
    if not args.run:
        return
    load_dotenv(ROOT / '.env')
    key = os.environ['UNIART_API_KEY']
    headers = {'Authorization': 'Bearer ' + key, 'X-Client-Request-Id': str(uuid.uuid4()),
               'Accept': 'text/event-stream'}
    # Explicitly no transport retry and no application retry.
    with httpx.Client(timeout=httpx.Timeout(connect=30, read=600, write=120, pool=30)) as client:
        trace = receive(client, os.getenv('UNIART_BASE_URL', 'https://uniart.fun/v1').rstrip('/')
                        + '/chat/completions', headers, payload, args.output)
    validation = {'transport_complete': trace['client_response_status'] == 'complete',
                  'json_parseable': False, 'semantic_accuracy': 'not_established'}
    if validation['transport_complete']:
        try:
            body = (args.output / 'response.txt').read_text().strip()
            if body.startswith('```'):
                body = body.split('\n', 1)[1].rsplit('```', 1)[0]
            parsed = json.loads(body)
            save(args.output / 'parsed.json', parsed)
            validation['json_parseable'] = True
            states = parsed.get('frame_states', [])
            validation['target_frame_coverage'] = sorted(s['source_frame'] for s in states) == [47, 49, 53]
        except (ValueError, TypeError, KeyError, AttributeError):
            validation['parse_or_shape_error'] = True
    save(args.output / 'validation.json', validation)
    print(json.dumps(trace, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
