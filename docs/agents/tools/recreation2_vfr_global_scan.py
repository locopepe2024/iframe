import hashlib,json,subprocess
from pathlib import Path
import cv2,numpy as np
from recreation2_effective_intrinsics_scale import ROOT
import recreation2_world_perspective_fit as base

VIDEO=Path('/private/tmp/recreation2-clip-exact10.mp4');OUT=ROOT/'docs/agents/raw/2026-10-23-vfr-global-scan'
def main():
 p=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time,width,height','-of','json',str(VIDEO)]))['frames']; pts=np.array([float(x['best_effort_timestamp_time']) for x in p])
 cap=cv2.VideoCapture(str(VIDEO));fs=[]
 while 1:
  ok,im=cap.read()
  if not ok:break
  fs.append(im)
 cap.release(); assert len(fs)==len(pts)==308 and np.all(np.diff(pts)>0)
 rows=[]
 for i in range(len(fs)-1):
  d=np.abs(fs[i+1].astype(np.int16)-fs[i].astype(np.int16)); rows.append({'from_frame_1based':i+1,'to_frame_1based':i+2,'delta_pts_ms':float((pts[i+1]-pts[i])*1000),'mae':float(d.mean()),'changed_pixel_rate_gt3':float((d>3).mean()),'near_duplicate':bool(d.mean()<.01 and (d>3).mean()<1e-4)})
 gaps=[r for r in rows if r['delta_pts_ms']>2000/30]
 near=[r for r in rows if r['near_duplicate']]
 OUT.mkdir(parents=True,exist_ok=True)
 report={'schema':'recreation2-vfr-global-scan.v1','video_sha256':base.digest(VIDEO),'frame_count':len(fs),'rows':rows,'large_gaps':gaps,'near_duplicate_pairs':near,'verification':{'pts_strict':True,'large_gap_count':len(gaps),'near_duplicate_pair_count':len(near)},'limits':['threshold is diagnostic only','no semantic action annotation','no timebase change']}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n'); print(json.dumps({'large_gaps':gaps,'near_duplicate_pair_count':len(near)},indent=2))
if __name__=='__main__':main()
