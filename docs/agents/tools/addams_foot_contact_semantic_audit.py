"""Classify existing shoe observations by visible contact phase, without rewriting labels."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
F=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json').read_text())
rows=[]
for joint,data in F['groups']['shoe_proxy'].items():
 for sf,xy in data['observations'].items():
  sf=int(sf); side='right' if joint.startswith('right') else 'left'
  if side=='right':
   phase='support_candidate'; contact='contact_candidate'; eligible=False
   reason='鞋面点靠近地面，邻帧显示脚尖/前缘接近地面；点本身仍非鞋底接触代理。'
  else:
   phase='airborne_swing_candidate'; contact='airborne_candidate'; eligible=False
   reason='邻帧中脚部抬起或前伸，未与地面形成可确认支撑；点用于足部朝向/轮廓证据。'
  rows.append({'source_frame':sf,'joint_label':joint,'xy':xy,'side':side,
   'phase_interpretation':phase,'contact_interpretation':contact,'sole_ik_eligible':eligible,
   'evidence_level':'hypothesis_from_adjacent_visual_context','reason':reason,
   'original_semantic_preserved':'shoe_proxy'})
rows.sort(key=lambda x:(x['source_frame'],x['joint_label']))
out={'schema':'addams-foot-contact-semantic-audit.v1','production_eligible':False,'rows':rows,
 'rule':'shoe_proxy evidence and contact target are separate; no point is used as IK target in this audit.',
 'limits':['No explicit ground-plane measurement enters this classification.','Contact_candidate is not contact fact.','No new pixel points generated.','Right support phase still requires floor and toe/sole contour verification.'],
 'next_step':'Use right support candidates only to test phase segmentation; use left airborne candidates only for orientation, never sole lock. Add a separate visible sole contour point only if manually verified.'}
outp=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary/contact-semantic-audit.json';outp.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(outp)
