"""Exact two-endpoint shoulder error decomposition; no motion changes."""
import json,math,statistics,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/addams-fixed-rig'
def sub(a,b):return [x-y for x,y in zip(a,b)]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def length(v):return math.hypot(*v)
def main():
 p=OUT/'chest-score.json';d=json.loads(p.read_text());rows=[];checks=[]
 for r in d['rows']:
  a,b=[r['predicted'][s+'_shoulder'] for s in ['left','right']];c,e=[r['source'][s+'_shoulder'] for s in ['left','right']]
  mid=[(a[i]+b[i]-c[i]-e[i])/2 for i in range(2)];v=sub(b,a);w=sub(e,c);lv,lw=length(v),length(w)
  mid2=dot(mid,mid);width2=(lv-lw)**2/4;angle2=(lv*lw-dot(v,w))/2
  rmse2=r['shoulder_rmse_px']**2;checks.append(abs(rmse2-mid2-width2-angle2))
  angle=math.degrees(math.atan2(w[0]*v[1]-w[1]*v[0],dot(v,w)))
  rows.append({'case':r['case'],'source_frame':r['source_frame'],'midpoint_error_xy':mid,'midpoint_error_px':length(mid),'source_width_px':lw,'target_width_px':lv,'width_ratio':lv/lw,'signed_shoulder_line_angle_deg':angle,'shoulder_rmse_px':r['shoulder_rmse_px'],'squared_terms_px2':{'midpoint':mid2,'width':width2,'direction':angle2}})
 assert max(checks)<1e-7,max(checks)
 summaries={}
 for case in ['hip_axis','hip_axis_chest']:
  v=[r for r in rows if r['case']==case];summaries[case]={k:statistics.median(abs(r[k]) if k=='signed_shoulder_line_angle_deg' else r[k] for r in v) for k in ['midpoint_error_px','width_ratio','signed_shoulder_line_angle_deg','shoulder_rmse_px']}
 report={'units':'960x520 pixels; squared terms px2','input_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'identity':'RMSE^2 = ||midpoint_delta||^2 + (target_width-source_width)^2/4 + target_width*source_width*(1-cos(angle))/2','identity_max_abs_error_px2':max(checks),'summary':summaries,'rows':rows,'limits':['Algebraic decomposition, not causal attribution','Screen-space shoulder line direction is not3D chest twist','Source MP joints are not ground truth','No new fitting or pose changes']}
 (OUT/'shoulder-decomposition.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(summaries,indent=2))
 for f in [6,22,23]:
  print(f,json.dumps([r for r in rows if r['source_frame']==f]))
if __name__=='__main__':main()
