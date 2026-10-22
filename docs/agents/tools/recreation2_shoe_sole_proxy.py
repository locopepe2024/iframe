import json,hashlib
from pathlib import Path
import numpy as np
from recreation2_effective_intrinsics_scale import ROOT

OUT=ROOT/'docs/agents/raw/2026-10-23-shoe-sole-proxy'
TRACK=ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json'
PTS=ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json'
VIDEO=Path('/private/tmp/recreation2-clip-exact10.mp4')
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def desc(a):
 a=np.asarray(a,float);return {'count':len(a),'min':float(a.min()),'median':float(np.median(a)),'p95':float(np.percentile(a,95)),'max':float(a.max())}
def main():
 raw=json.loads(TRACK.read_text())['frames']; pts={x['track_frame']:x['source_pts_s'] for x in json.loads(PTS.read_text())['sampled_track_frames']}
 rows=[]
 for x in raw:
  if not x.get('target_landmarks') or x['frame'] not in pts:continue
  lm=np.asarray(x['target_landmarks'],float); row={'frame':x['frame'],'source_pts_s':pts[x['frame']]}
  for side,a,h,t in [('left',27,29,31),('right',28,30,32)]:
   ankle=lm[a,:2]*[1394,792]; heel=lm[h,:2]*[1394,792]; toe=lm[t,:2]*[1394,792];sole=(heel+toe)/2
   row[side]={'ankle_xy_px':ankle.tolist(),'heel_xy_px':heel.tolist(),'toe_xy_px':toe.tolist(),'sole_proxy_xy_px':sole.tolist(),'sole_segment_length_px':float(np.linalg.norm(toe-heel)),'sole_minus_ankle_dy_px':float(sole[1]-ankle[1]),'visibility':{'ankle':float(lm[a,3]),'heel':float(lm[h,3]),'toe':float(lm[t,3])}}
  rows.append(row)
 intervals=[]
 for a,b in zip(rows,rows[1:]):
  dt=b['source_pts_s']-a['source_pts_s']
  if dt<=0:continue
  z={'from_frame':a['frame'],'to_frame':b['frame'],'dt_s':dt}
  for side in ('left','right'):
   for key in ('sole_proxy_xy_px','ankle_xy_px'):
    z[side+'_'+key+'_speed_px_s']=float(np.linalg.norm(np.asarray(b[side][key])-a[side][key])/dt)
  z['pts_gap_over_two_30hz_steps']=dt>2/30
  intervals.append(z)
 dy={s:desc([x[s]['sole_minus_ankle_dy_px'] for x in rows]) for s in ('left','right')}
 segment={s:desc([x[s]['sole_segment_length_px'] for x in rows]) for s in ('left','right')}
 speed={}
 for s in ('left','right'):
  speed[s]={k:desc([x[s+'_'+k+'_speed_px_s'] for x in intervals]) for k in ('sole_proxy_xy_px','ankle_xy_px')}
 report={'schema':'recreation2-shoe-sole-proxy.v1','input_sha256':{str(p):digest(p) for p in (TRACK,PTS,VIDEO)},'frame_count':len(rows),'rows':rows,'intervals':intervals,'summary':{'sole_minus_ankle_dy_px':dy,'sole_segment_length_px':segment,'speed_px_s':speed},'verification':{'no_interpolation':True,'real_pts_used':True,'largest_gap_interval':max(intervals,key=lambda x:x['dt_s']),'frame_range':[rows[0]['frame'],rows[-1]['frame']]},'limits':['heel/toe midpoint is image proxy, not physical shoe-bottom contact','MediaPipe points are not independent truth','no support-foot threshold selected','no IK, ground-plane or production change']}
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['summary'],indent=2))
if __name__=='__main__':main()
