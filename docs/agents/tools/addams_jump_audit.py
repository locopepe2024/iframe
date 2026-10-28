"""Trace continuity failures to saved predictions and solver regularization."""
import gzip,json,math
from pathlib import Path
B=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
O=B/'addams-jump-audit-v1';O.mkdir(exist_ok=True)
fit=json.loads((B/'addams-continuous-shot1-v2/fit.json').read_text())
obs=json.loads(gzip.decompress((B/'addams-segment-review-v1/observations.json.gz').read_bytes()))
names=['upper_leg_l','lower_leg_l','upper_leg_r','lower_leg_r'];steps=[]
for a,b in zip(fit['frames'],fit['frames'][1:]):
 for k,name in enumerate(names):
  dot=sum(x*y for x,y in zip(a['leg_directions_blender'][k],b['leg_directions_blender'][k]));steps.append({'from_frame':a['source_frame'],'to_frame':b['source_frame'],'bone':name,'angle_deg':math.degrees(math.acos(max(-1,min(1,dot))))})
rows=[]
for sf in [48,49,50,51,52,53,54,55,56,57,58]:
 r=obs[sf-1];mp=r['mp_people'][0];det=r['independent_people']
 rows.append({'source_frame':sf,'pts_s':r['pts_s'],'mp_people':len(r['mp_people']),'detector_people':len(det),
 'mp_lower_body':[{'joint':j,'xy_review_px':[mp['landmarks'][j]['x']/4,mp['landmarks'][j]['y']/4],'visibility':mp['landmarks'][j]['visibility']} for j in [23,24,25,26,27,28]],
 'independent_lower_body_candidates':[{'candidate':k,'joints':[{'joint':j,'xy_review_px':[v/4 for v in p['coco17_xy'][j]],'score':p['scores'][j]} for j in [11,12,13,14,15,16]]} for k,p in enumerate(det)]})
report={'schema':'addams-jump-audit.v1','top_steps':sorted(steps,key=lambda x:-x['angle_deg'])[:16],'source_rows':rows,
 'code_facts':['continuous_candidate accepts a joint when min(world visibility, image visibility)>=0.35; no geometric cross-model consistency validation.',
 'continuous_fit computes correction=params-initial then penalizes second difference of correction, not absolute directions.',
 'At params=initial, correction regularization is zero even if the baseline contains a large direction jump.'],
 'limits':['Source direction errors observed visually; no new human joint truth on frames49/52–56.', 'RTMPose is independent evidence, not automatically accepted truth.', 'No new animation candidate or contact acceptance.']}
assert report['top_steps'][0]['from_frame']==55 and report['top_steps'][0]['to_frame']==56
(O/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['top_steps'][:3],indent=2))
