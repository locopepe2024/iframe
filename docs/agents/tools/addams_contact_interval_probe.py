"""Derive conservative phase intervals from selected shoe observations only."""
import json,math,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
d=json.loads((ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary/contact-semantic-audit.json').read_text())
rows=[]
for side in ['right','left']:
 r=sorted([x for x in d['rows'] if x['side']==side],key=lambda x:x['source_frame'])
 steps=[]
 for a,b in zip(r,r[1:]):
  steps.append({'from':a['source_frame'],'to':b['source_frame'],'distance_px':math.dist(a['xy'],b['xy'])})
 rows.append({'side':side,'observations':[x['source_frame'] for x in r],'steps':steps,'median_step_px':statistics.median([x['distance_px'] for x in steps]) if steps else None})
out={'schema':'addams-contact-interval-probe.v1','production_eligible':False,'rows':rows,
 'interval_candidates':[{'side':'right','frames':[51,55],'status':'conservative_support_candidate','reason':'small observed point steps after 49→51 transition; shoe upper point still not sole/contact fact'},
 {'side':'right','frames':[49,49],'status':'transition_candidate','reason':'do not lock from preceding observation due 19.48px step'},
 {'side':'left','frames':[50,53],'status':'airborne_swing_candidate','reason':'large point steps and elevated visible foot context; not ground proof'}],
 'limits':['Sparse observations; intervals are not full-frame labels.','Point movement includes body motion, foot articulation, projection and possible annotation noise.','No IK or floor constraint applied.','SAM status remains gated; no model output included.'],
 'next_step':'Use 51–55 only as a soft phase prior in a contact ablation; compare with no-contact baseline and reject if non-support limbs or projection worsen.'}
p=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary/contact-interval-probe.json';p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(p)
