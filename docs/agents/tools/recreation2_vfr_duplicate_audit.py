import hashlib, json, subprocess
from pathlib import Path
import cv2, numpy as np
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT

VIDEO=Path('/private/tmp/recreation2-clip-exact10.mp4')
OUT=ROOT/'docs/agents/raw/2026-10-23-vfr-duplicate-audit'

def main():
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames',
        '-show_entries','frame=best_effort_timestamp_time,width,height','-of','json',str(VIDEO)]))['frames']
    pts=np.array([float(x['best_effort_timestamp_time']) for x in probe])
    cap=cv2.VideoCapture(str(VIDEO)); frames=[]
    while True:
        ok,im=cap.read()
        if not ok: break
        frames.append(im)
    cap.release(); assert len(frames)==len(pts)==308
    rows=[]
    for i in range(8,14):
        d=np.abs(frames[i+1].astype(np.int16)-frames[i].astype(np.int16))
        rows.append({'from_frame_1based':i+1,'to_frame_1based':i+2,'from_pts_s':float(pts[i]),'to_pts_s':float(pts[i+1]),
          'delta_pts_ms':float((pts[i+1]-pts[i])*1000),'mae':float(d.mean()),
          'p95_abs_delta':float(np.percentile(d,95)),'changed_pixel_rate_gt3':float((d>3).mean()),
          'from_bgr_sha256':hashlib.sha256(frames[i].tobytes()).hexdigest(),
          'to_bgr_sha256':hashlib.sha256(frames[i+1].tobytes()).hexdigest()})
    # Strongly near-duplicate criterion is an audit label, not a content truth claim.
    for r in rows:r['near_duplicate_by_audit_threshold']=r['mae']<0.01 and r['changed_pixel_rate_gt3']<1e-4
    OUT.mkdir(parents=True,exist_ok=True)
    report={'schema':'recreation2-vfr-duplicate-audit.v1','video_sha256':base.digest(VIDEO),
      'frame_count':len(frames),'rows':rows,
      'verification':{'pts_strictly_increasing':bool(np.all(np.diff(pts)>0)),
          'frame_shape':list(frames[0].shape),'frame11_to12_near_duplicate':rows[2]['near_duplicate_by_audit_threshold']},
      'limits':['Near-duplicate threshold is diagnostic, not a codec standard',
          'No optical-flow or semantic action annotation', 'No timebase or production change']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
