"""Full-clip multi-person proposal scan; identities deliberately unassigned."""
import json,hashlib,subprocess,time
from pathlib import Path
import cv2,mediapipe as mp
BASE=Path('/tmp/addams-pose');OUT=BASE/'full-scan-v1';OUT.mkdir(exist_ok=True)
video=BASE/'source.mp4';weight=Path('/opt/motion-pose-models/pose_landmarker_full.task')
pts=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(video)]))['frames']
options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(weight)),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=2)
cap=cv2.VideoCapture(str(video));rows=[];start=time.time()
with mp.tasks.vision.PoseLandmarker.create_from_options(options) as model:
 for i,frame in enumerate(pts):
  ok,bgr=cap.read();assert ok
  h,w=bgr.shape[:2];rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB);timestamp=float(frame['best_effort_timestamp_time'])
  result=model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(timestamp*1000));people=[]
  for lm,world in zip(result.pose_landmarks,result.pose_world_landmarks):
   people.append({'landmarks':[{'x':p.x*w,'y':p.y*h,'visibility':p.visibility} for p in lm],
                  'world_landmarks':[{'x':p.x,'y':p.y,'z':p.z,'visibility':p.visibility} for p in world],
                  'identity':'unassigned'})
  rows.append({'source_frame':i+1,'pts_s':timestamp,'image_size':[w,h],'people':people})
  if i%25==0:print('frame',i+1,'people',len(people),flush=True)
cap.release()
report={'schema':'addams-full-proposal-scan.v1','frames':len(rows),'source_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),
        'weight_sha256':hashlib.sha256(weight.read_bytes()).hexdigest(),'runtime_seconds':time.time()-start,
        'frames_with_any_pose':sum(bool(r['people']) for r in rows),'frames_with_two_poses':sum(len(r['people'])==2 for r in rows),
        'missing_source_frames':[r['source_frame'] for r in rows if not r['people']],
        'limits':['Proposal detection only, no subject tracking; later poses may belong to second character.','VIDEO state spans cuts; cut-aware rerun required for acceptance.','Model world coordinates are hip-relative estimates, not scene depth.','No new rig, camera, contacts or motion acceptance.']}
(OUT/'observations.json').write_text(json.dumps(rows,indent=2)+'\n');(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
