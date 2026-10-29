"""Record visual interpretations separately from original human decisions."""
import json
from addams_vlm_stream_probe import ROOT
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary'
f=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json').read_text())
rows=[]
for joint,data in f['groups']['shoe_proxy'].items():
 for sf,xy in data['observations'].items():
  rows.append({'source_frame':int(sf),'joint_label':joint,'selected_xy':xy,
    'original_user_semantic':'shoe_proxy','original_decision_preserved':True,
    'visual_interpretation':'shoe_upper_near_ankle_or_boot_shaft_transition',
    'evidence_type':'agent_visual_interpretation_not_human_confirmation',
    'physical_subtype':'not_resolved','sole_contact_target_eligible':False,
    'joint_center_target_eligible':False,
    'reason':'Selected marker is near proximal shoe/shaft, not an identified heel/forefoot/toe sole landmark. Exact anatomical ankle center remains unverified.'})
rows.sort(key=lambda r:(r['source_frame'],r['joint_label']))
out={'schema':'addams-shoe-proxy-visual-audit.v1','rows':rows,
 'evidence_image':'shoe-context.jpg','production_eligible':False,
 'limits':['Adjacent crops use the selected-frame pixel window, not tracked point locations.',
 'Only central frames carry markers; neighboring positions are contextual images.',
 'Foot contact and anatomical ankle center cannot be established by these markers.',
 'No original user semantics or coordinates modified.'],
 'next_step':'Preserve these as generic visible-shoe evidence. Define separate sole landmarks from mesh/visible source contour before contact IK; only explicit joint-center observations constrain anatomical ankle.'}
(OUT/'visual-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
(OUT/'review.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>七个鞋点复查</title><style>body{background:#17191c;color:#eee;font:16px/1.7 system-ui;margin:24px}img{max-width:100%}</style><h1>已有七个鞋点 · 邻帧复查</h1><p>每行左中右为前帧、已选帧、后帧；黄圈仅标出中间帧已有选择。邻帧沿用同一裁剪窗口，没有点追踪。图片放大未增加源细节。</p><p>视觉复查解释：这些点靠近鞋面/鞋筒与踝部连接，未明确标识后跟、前掌或脚尖鞋底；不能直接作贴地约束，也不能直接升级为踝骨中心。原始用户选择shoe_proxy保持不变，本解释为待验证的agent判断。</p><img src="shoe-context.jpg"><p>下一步把鞋面观测、解剖踝中心和鞋底接触拆开处理；源64帧腾空语义保持原用户确认。</p></html>''')
print('recorded',len(rows),'separate interpretations')
