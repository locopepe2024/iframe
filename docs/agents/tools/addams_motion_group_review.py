"""Review semantic keyframes for a motion group, not every frame."""
import json
from pathlib import Path
from addams_vlm_stream_probe import ROOT
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1';OUT.mkdir(exist_ok=True)
group={'group_id':'G1','frames':[49,51,53,55],'roles':['entry','support_peak','left_swing_peak','exit'],
 'source_range':[49,55],'action_semantics':{'left_leg':'lifted_forward_swing','right_leg':'forefoot_support','right_heel':'raised'},
 'boundary_status':'candidate','notes':''}
(OUT/'keyframe-template.json').write_text(json.dumps({'schema':'addams-motion-group-keyframe-review.v1','group':group,'production_eligible':False},ensure_ascii=False,indent=2)+'\n')
items=[]
for sf,role in zip(group['frames'],group['roles']):
 items.append(f'''<article><h2>{role} · 源{sf} · {(sf-1)/25:.2f}s</h2><img src="../2026-10-29-addams-vlm-phase-test-v1/dense/frame-{sf:03}.jpg"><label>左脚<input data-f="{sf}" data-k="left_phase" value="lifted_forward_swing"></label><label>右脚<input data-f="{sf}" data-k="right_phase" value="forefoot_support"></label><label>右脚跟<input data-f="{sf}" data-k="right_heel" value="raised"></label><label>备注<textarea data-f="{sf}" data-k="notes"></textarea></label></article>''')
html='''<!doctype html><meta charset="utf-8"><title>G1动作组关键帧</title><style>body{background:#17191c;color:#eee;font:16px system-ui;margin:24px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}article{background:#24272b;padding:12px}img{width:100%}input,textarea{display:block;width:100%;box-sizing:border-box;background:#30343a;color:#fff;border:1px solid #555;margin:5px 0;padding:6px}button{padding:8px;margin:10px 5px 10px 0}</style><h1>G1 · 左脚抬起前行 / 右脚踮脚支撑</h1><p>只复核4个语义关键帧；组内其余帧继承组关系后做时序拟合，不再逐帧重复点膝盖或脚底。若边界不对，在备注中说明。</p><button onclick="download()">下载组级JSON</button><div class="grid">'''+''.join(items)+'''</div><script>function download(){let rows=[...new Set([...document.querySelectorAll('[data-f]')].map(x=>x.dataset.f))].map(f=>{let r={source_frame:+f};document.querySelectorAll('[data-f="'+f+'"]').forEach(x=>r[x.dataset.k]=x.value);return r});let d={schema:'addams-motion-group-keyframe-review.v1',group_id:'G1',source_range:[49,55],keyframes:rows,production_eligible:false,rule:'group semantics are soft until boundaries and keyframes are verified'};let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));a.download='G1-keyframes.json';a.click()}</script>'''
(OUT/'keyframe-review.html').write_text(html)
print(OUT/'keyframe-review.html')
