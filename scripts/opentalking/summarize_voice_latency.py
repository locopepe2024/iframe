"""Read filtered diagnostic log lines on stdin; print metadata-only per-turn timings."""
import json
import sys

traces = {}
for line in sys.stdin:
    for marker in ('Companion voice diagnostic ', 'Companion latency '):
        if marker not in line:
            continue
        try:
            item = json.loads(line.split(marker, 1)[1])
        except (ValueError, TypeError):
            continue
        trace_id = item.get('trace_id')
        if not trace_id:
            continue
        trace = traces.setdefault(trace_id, {'stages': {}, 'server_phases': []})
        if marker == 'Companion latency ':
            trace['server_phases'].append({k:item[k] for k in ('phase', 'duration_ms', 'status') if k in item})
        elif item.get('event') == 'stage':
            trace['stages'].setdefault(item['state'], []).append(item)

for trace_id, trace in traces.items():
    stages = trace['stages']
    def first(name):
        return (stages.get(name) or [{}])[0]
    def gap(a, b):
        start, end = first(a).get('elapsed_ms'), first(b).get('elapsed_ms')
        return end-start if start is not None and end is not None else None
    asr = first('asr_received')
    residual = (asr['duration_ms']-asr['server_ms']) if 'duration_ms' in asr and 'server_ms' in asr else None
    print(json.dumps({'trace_id':trace_id,
        'asr_round_trip_ms':asr.get('duration_ms'), 'asr_handler_ms':asr.get('server_ms'),
        'asr_inference_ms':asr.get('inference_ms'), 'asr_unattributed_ms':residual,
        'chat_queue_ms':gap('chat_enqueued','chat_dequeued'),
        'chat_round_trip_ms':first('chat_received').get('duration_ms'),
        'server_phases':trace['server_phases'],
        'tts_request_to_decoded_energy_ms':gap('tts_sent','audio_energy'),
        'segment_ready_to_decoded_energy_ms':gap('segment_ready','audio_energy'),
        'webrtc':{k:v for k,v in first('webrtc_stats').items() if k in ('rtt_ms','jitter_ms','jitter_buffer_ms')},
        'opentalking_session':first('tts_sent').get('session_id'),
        'command_id':first('tts_sent').get('command_id'),
    }, ensure_ascii=False))
