"""Build a read-only review of frozen semantic candidates and held-out disagreements."""
import html
import json
from pathlib import Path
from addams_vlm_stream_probe import ROOT, save

OUT = ROOT / 'docs/agents/raw/2026-10-29-addams-semantic-completion-v1'
parsed = json.loads((OUT / 'parsed.json').read_text())
evaluation = json.loads((OUT / 'evaluation.json').read_text())
states = {r['source_frame']: r for r in parsed['frame_states']}
rows = [row for row in evaluation['rows'] if not row['match']]
review = {'status': 'needs_visual_review', 'production_eligible': False,
          'reason': 'Contact disagreements and unsupported certainty must be resolved before IK.',
          'disputes': [{**row, 'model_state': states[row['source_frame']],
                        'human_label_is_infallible': False} for row in rows],
          'phase_candidates': parsed['phases'],
          'limits': ['Semantic completion candidates, not recovered ground-truth motion.',
                     'No inferred 3D coordinates or solver hard constraints emitted.']}
save(OUT / 'review-queue.json', review)
parts = ['<!doctype html><html lang="zh"><meta charset="utf-8"><title>连续语义补全 · 分歧复核</title>',
         '<style>body{background:#16181c;color:#eee;font:16px/1.6 system-ui;margin:24px}article{border-top:1px solid #555;padding:20px 0}.frames{display:flex;gap:8px;overflow:auto}.frames figure{margin:0;min-width:300px;max-width:480px;flex:1}.frames img{width:100%}pre{white-space:pre-wrap}a{color:#9ad}</style>',
         '<h1>连续语义补全 · 分歧复核</h1><p>一个第49帧左右脚身份锚点 + 第46–65连续帧。五个留出帧与已有接触标签一致2/5；已有标签也需要核对。此页只读，所有推断均未写入动作或IK。</p>',
         '<p>检查顺序：可见腿轨迹 → 解剖左右 → 脚是否接触。不要将“正在跑”直接转换成确定支撑。</p>',
         '<p>帧号按25fps，PTS=(帧号−1)/25。</p>']
for row in rows:
    sf = row['source_frame']
    state = states[sf]
    parts.extend([f'<article><h2>源第{sf}帧 · {(sf-1)/25:.2f}s</h2>',
                  f'<p>既有标注：{html.escape(row["human_support"])}；模型候选：{html.escape(row["predicted_support"])}；模型自报把握：{state["certainty"]}。</p>', '<div class="frames">'])
    for frame in range(max(46, sf - 1), min(65, sf + 1) + 1):
        src = f'../2026-10-29-addams-vlm-phase-test-v1/dense/frame-{frame:03}.jpg'
        parts.append(f'<figure><img src="{src}" alt="源第{frame}帧"><figcaption>源第{frame}帧 · {(frame-1)/25:.2f}s</figcaption></figure>')
    parts.extend(['</div><pre>' + html.escape(json.dumps(state, ensure_ascii=False, indent=2)) + '</pre></article>'])
parts.append('<h2>完整连续画面</h2><img style="max-width:100%" src="review-sheet.jpg" alt="第46–65连续画面"></html>')
(OUT / 'review.html').write_text('\n'.join(parts))
print('Built read-only review for', [r['source_frame'] for r in rows])
