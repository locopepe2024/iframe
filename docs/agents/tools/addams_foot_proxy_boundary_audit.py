"""Audit existing target proxy geometry and source semantic identifiability."""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
RAW=ROOT/'docs/agents/raw'
contract=json.loads((RAW/'2026-10-29-addams-native-layered-v1/target-rig-contract.json').read_text())
fusion=json.loads((RAW/'2026-10-29-addams-temporal-soft-fusion-v1.json').read_text())
fit=json.loads((RAW/'2026-10-30-addams-ankle-prior-v1/report.json').read_text())
feet={}
for side,f in contract['feet'].items():
 a=contract['bones']['ankle_'+side]['head_rest_world']
 feet[side]={}
 for part in ['heel','forefoot']:
  delta=[x-y for x,y in zip(f[part+'_rest_world'],a)]
  feet[side][part]={'ankle_to_proxy_rest_world_m':delta,'distance_m':math.sqrt(sum(x*x for x in delta)),'foot_local':f['proxies_foot_local'][part]}
 # Compare only actual selected observations; interpolants do not add evidence.
 joint=('left' if side=='l' else 'right')+'_ankle'
 centers=fusion['groups']['joint_center'].get(joint,{}).get('observations',{})
 proxies=fusion['groups']['shoe_proxy'].get(joint,{}).get('observations',{})
 feet[side]['source_joint_center_frames']=sorted(map(int,centers))
 feet[side]['source_shoe_proxy_frames']=sorted(map(int,proxies))
 feet[side]['same_frame_selected_center_and_proxy']=sorted(map(int,set(centers)&set(proxies)))
case=fit['cases'][1]
rows=sorted(case['scores'],key=lambda r:r['fitted_px'],reverse=True)
out={'schema':'addams-foot-proxy-boundary-audit.v1','production_eligible':False,'feet':feet,'residuals_descending':rows,
 'source_proxy_subtype':'unknown: shoe_proxy selection does not identify heel/forefoot/toe/silhouette extremum',
 'conclusion':'Target foot offsets exist, but source shoe_proxy observations do not establish matching physical points.',
 'next_step':'Visually classify existing selected shoe points against target proxy definitions before using projection or IK targets; no new full-frame annotation.',
 'limits':['Target proxy clusters are heuristic; existing checks establish coordinate consistency, not anatomical truth.',
 'Rest offsets rotate/deform with articulated foot; never add a constant 2D pixel offset.',
 'No same-frame selected center/proxy pairs; interpolants cannot establish measured ankle-to-sole offsets.',
 'Right-knee residual concentration does not identify its cause: camera, pose, proportions and selected coordinates remain possible.']}
folder=RAW/'2026-10-30-addams-foot-proxy-boundary';folder.mkdir(exist_ok=True)
(folder/'report.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'feet':feet,'largest_residuals':[(r['source_frame'],r['joint'],round(r['fitted_px'],2)) for r in rows[:5]]},ensure_ascii=False,indent=2))
