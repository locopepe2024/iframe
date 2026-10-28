import json,hashlib
from pathlib import Path
import cv2,mediapipe as mp
p=Path('/tmp/addams-pose');old=json.loads((p/'observations.json').read_text());w=Path('/opt/motion-pose-models/pose_landmarker_full.task')
options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(w)),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1)
cap=cv2.VideoCapture(str(p/'source.mp4'));rows=[];maxgap=0
with mp.tasks.vision.PoseLandmarker.create_from_options(options) as model:
 for i in range(50):
  ok,img=cap.read();assert ok
  h,width=img.shape[:2];rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
  r=model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(old[i]['source_pts_s']*1000))
  assert bool(r.pose_landmarks)==bool(old[i]['mediapipe'])
  if r.pose_landmarks:
   for a,b in zip(r.pose_landmarks[0],old[i]['mediapipe']):maxgap=max(maxgap,abs(a.x*width-b['x']),abs(a.y*h-b['y']))
  rows.append({'source_frame':i+1,'pts_s':old[i]['source_pts_s'],'pose_world_landmarks':[[{'x':a.x,'y':a.y,'z':a.z,'visibility':a.visibility,'presence':a.presence} for a in person] for person in r.pose_world_landmarks]})
cap.release();assert maxgap<.01,maxgap
(p/'world-candidate.json').write_text(json.dumps({'schema':'addams-mp-world-candidate.v1','weight_sha256':hashlib.sha256(w.read_bytes()).hexdigest(),'repeated_2d_max_delta_native_px':maxgap,'coordinate_contract':'MediaPipe pose_world_landmarks; hip-centered model estimate; not global trajectory or calibrated scene scale','frames':rows,'status':'REVIEW','limits':['Not a GVHMR/WHAM substitute or verified world motion','No recovered global root, true camera, contacts or rig retarget','Cartoon body proportions unvalidated']},indent=2))
