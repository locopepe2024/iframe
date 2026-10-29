"""Fuse user-selected 2D candidates into diagnostic temporal tracks only."""
import json,math,statistics
from pathlib import Path
from addams_vlm_stream_probe import ROOT,save
D=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-joint-semantics-v1/applied-decisions.json').read_text())
H=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-native-layered-v1/human-score.json').read_text())
lookup={(f['source_frame'],p['joint']):p for f in H['frames'] for p in f['points']}
frames=list(range(46,66)); groups={'joint_center':{},'shoe_proxy':{}}
for row in D['rows']:
 key=(row['source_frame'],row['joint']); p=lookup.get(key)
 if not p:continue
 coord=row['coordinate']; pt=p.get({'human_y':'review_xy','native_m':'native_xy','vitpose_c':'vitpose_xy'}.get(coord,''))
 if pt is None:continue
 groups[row['semantic']].setdefault(row['joint'],{})[row['source_frame']]=pt

def interp(obs):
 out={}; ids=sorted(obs)
 for f in frames:
  if f in obs:out[f]={'xy':obs[f],'kind':'observed'};continue
  if not ids:continue
  if f<ids[0]:out[f]={'xy':obs[ids[0]],'kind':'edge_hold'};continue
  if f>ids[-1]:out[f]={'xy':obs[ids[-1]],'kind':'edge_hold'};continue
  a=max(i for i in ids if i<f);b=min(i for i in ids if i>f);t=(f-a)/(b-a)
  out[f]={'xy':[obs[a][0]*(1-t)+obs[b][0]*t,obs[a][1]*(1-t)+obs[b][1]*t],'kind':'linear_interpolation','bracket':[a,b]}
 return out
report={'schema':'addams-temporal-soft-fusion.v1','source_range':[46,65],'fps':25,'production_eligible':False,'groups':{}}
for group,joints in groups.items():
 report['groups'][group]={}
 for joint,obs in joints.items():
  track=interp(obs);steps=[]
  for a,b in zip(frames,frames[1:]):
   if a in track and b in track:steps.append({'from':a,'to':b,'distance_px':math.dist(track[a]['xy'],track[b]['xy'])})
  report['groups'][group][joint]={'observations':obs,'track':track,'max_step_px':max((x['distance_px'] for x in steps),default=None),'median_step_px':statistics.median([x['distance_px'] for x in steps]) if steps else None,'steps':steps}
report['limits']=['2D diagnostic only; no depth, camera or Blender output.','Linear interpolation is a baseline, not final motion model.','Observations selected using existing review points; no independent ground truth.','No contact or airborne states inferred from XY tracks.']
save(ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json',report)
print(json.dumps({g:{j:{'obs':len(v['observations']),'max_step':v['max_step_px']} for j,v in js.items()} for g,js in report['groups'].items()},ensure_ascii=False))
