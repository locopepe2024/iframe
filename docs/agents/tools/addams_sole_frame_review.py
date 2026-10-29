"""Create low-burden frame-level sole evidence review; no coordinates required."""
import json
from pathlib import Path
from addams_vlm_stream_probe import ROOT,FRAMES
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-sole-frame-review-v1';OUT.mkdir(exist_ok=True)
rows=[]
for sf in range(46,66):
 rows.append({'source_frame':sf,'pts_s':(sf-1)/25,'image':f'frame-{sf:03}.jpg',
  'sole_evidence':'pending','contact_evidence':'pending','visibility_note':'pending','notes':''})
manifest={'schema':'addams-sole-frame-review.v1','source_range':[46,65],'fps':25,'production_eligible':False,
 'choices':{'sole_evidence':['verified_visible','partial_contour','unavailable','out_of_frame'],
            'contact_evidence':['contact_candidate','airborne_candidate','unknown'],
            'visibility_note':['front_or_clear','side_but_contour','blurred','occluded','cut_or_unclear']},
 'rule':'No coordinate entry. unavailable/unknown routes to temporal inference or manual review and blocks foot IK.',
 'rows':rows}
(OUT/'template.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
items=[]
for r in rows:
 sf=r['source_frame'];items.append(f'''<article><h3>源{sf} · {r['pts_s']:.2f}s</h3><img src="../2026-10-29-addams-vlm-phase-test-v1/dense/frame-{sf:03}.jpg"><label>鞋底证据 <select data-f="{sf}" data-k="sole_evidence"><option value="pending">待判断</option><option>verified_visible</option><option>partial_contour</option><option>unavailable</option><option>out_of_frame</option></select></label><label>接触证据 <select data-f="{sf}" data-k="contact_evidence"><option value="pending">待判断</option><option>contact_candidate</option><option>airborne_candidate</option><option>unknown</option></select></label><label>可见性 <select data-f="{sf}" data-k="visibility_note"><option value="pending">待判断</option><option>front_or_clear</option><option>side_but_contour</option><option>blurred</option><option>occluded</option><option>cut_or_unclear</option></select></label><textarea data-f="{sf}" data-k="notes" placeholder="可选说明"></textarea></article>''')
html='''<!doctype html><meta charset="utf-8"><title>帧级鞋底证据</title><style>body{background:#17191c;color:#eee;font:15px system-ui;margin:20px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}article{background:#24272b;padding:10px}img{width:100%;display:block;margin-bottom:8px}label,textarea{display:block;margin:6px 0;width:100%}select,textarea{background:#30343a;color:#fff;border:1px solid #555;padding:5px}button{padding:8px;margin:8px 5px 8px 0}#state{color:#9f9}h1{margin-top:0}</style><h1>第46–65帧 · 鞋底证据门控</h1><p>这里只判断“证据是否存在”，不点坐标。模糊、侧身且没有鞋底轮廓时选 unavailable；无法确认接触选 unknown。unavailable/unknown 不进入脚底IK。</p><button onclick="save()">保存</button><button onclick="download()">下载JSON</button><span id="state"></span><div class="grid">'''+''.join(items)+'''</div><script>const key='addams-sole-frame-review-v1';function save(){let rows=[...new Set([...document.querySelectorAll('[data-f]')].map(x=>x.dataset.f))].map(f=>{let r={source_frame:+f};document.querySelectorAll('[data-f="'+f+'"]').forEach(x=>r[x.dataset.k]=x.value);return r});localStorage.setItem(key,JSON.stringify({schema:key,rows}));document.querySelector('#state').textContent=' 已保存 '+rows.length+'帧'}function download(){save();let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([localStorage.getItem(key)],{type:'application/json'}));a.download='sole-frame-review.json';a.click()}</script>'''
(OUT/'review.html').write_text(html)
print(OUT/'review.html')
