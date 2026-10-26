"""Reconcile segment probe and event baseline, then decompose root motion."""
import argparse, json, math, statistics
from pathlib import Path
p=argparse.ArgumentParser()
for k in ('report','events','bundle','out'):p.add_argument('--'+k,required=True)
a=p.parse_args();x=json.loads(Path(a.report).read_text());events=json.loads(Path(a.events).read_text());bundle=json.loads(Path(a.bundle).read_text());fs={r['frame']:r for r in bundle['frames']};by={r['source_frame']:r for r in x['rows']}
def sub(a,b):return [u-v for u,v in zip(a,b)]
def summary(vals):return {'median':statistics.median(vals),'max':max(vals)}
reg=[]
for r in events['rows']:
 if r['target']!='patch':continue
 sample=by[r['source_frame']]['feet'][r['side']]['patches']['all']['centroid'];diff=math.dist(sample,r['patch_before']);assert diff<1e-7;reg.append(diff)
result=[]
for w in x['support_candidates']:
 vals=[];roots=[];locals_=[];detail=[]
 for iv in x['intervals']:
  if not w['source_first']<=iv['source_from'] or iv['source_to']>w['source_last']:continue
  prev=by[iv['source_from']];cur=by[iv['source_to']];s=w['side'];dt=iv['dt_s'];v=[]
  for part in ('rear_candidate','front_candidate'):
   v.append(sub(cur['feet'][s]['patches'][part]['centroid'],prev['feet'][s]['patches'][part]['centroid'])[:2])
  den=(math.hypot(*v[0])+math.hypot(*v[1]))/2;mismatch=math.dist(v[0],v[1])/den if den>1e-10 else None
  if mismatch is not None:vals.append(mismatch)
  f0=fs[prev['new_bundle_frame']];f1=fs[cur['new_bundle_frame']]
  pos=prev['feet'][s]['patches']['all']['centroid'];nxt=cur['feet'][s]['patches']['all']['centroid']
  delta=f1['rootYaw']-f0['rootYaw'];co=math.cos(delta);si=math.sin(delta);q=sub(pos,f0['rootPosition'])
  rigid=[co*q[0]-si*q[1]+f1['rootPosition'][0],si*q[0]+co*q[1]+f1['rootPosition'][1],q[2]+f1['rootPosition'][2]]
  root_v=sub(rigid,pos);local_v=sub(nxt,rigid);observed=sub(nxt,pos)
  residual=max(abs(root_v[i]+local_v[i]-observed[i]) for i in range(3));assert residual<1e-10
  roots.append(math.hypot(*root_v[:2])/dt);locals_.append(math.hypot(*local_v[:2])/dt)
  detail.append(dict(source_from=iv['source_from'],source_to=iv['source_to'],dt_s=dt,mismatch_ratio=mismatch,root_displacement=root_v,local_displacement=local_v,observed_displacement=observed,vector_sum_residual=residual))
 result.append(dict(window=w,front_rear_displacement_mismatch=summary(vals),root_only_horizontal_speed=summary(roots),local_remainder_horizontal_speed=summary(locals_),intervals=detail))
Path(a.out).write_text(json.dumps({'schema':'recreation2-sole-segment-review.v1','event_patch_reproduction_max':max(reg),'results':result,'limits':['root/local are ordered finite-transform vector terms; scalar magnitudes do not add','front/rear displacement agreement is not proof of physical slip','no direct source-shoe metric motion or floor calibration']},indent=2)+'\n')
print('SEGMENT_REVIEW_PASS',max(reg))
