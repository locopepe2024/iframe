import json,hashlib,importlib.metadata,subprocess
from pathlib import Path
import cv2,numpy as np,mediapipe as mp
from rtmlib import RTMPose
OUT=Path('/tmp/addams-pose');video=OUT/'source.mp4'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
weights=next(Path('/opt/motion-pose-models/rtmpose').rglob('end2end.onnx'))
rtm=RTMPose(str(weights),model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path='/opt/motion-pose-models/pose_landmarker_full.task'),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=1)
pts=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(video)]))['frames']
cap=cv2.VideoCapture(str(video));rows=[]
with mp.tasks.vision.PoseLandmarker.create_from_options(options) as model:
 for i in range(50):
  ok,bgr=cap.read();assert ok
  h,w=bgr.shape[:2];rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB)
  result=model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(float(pts[i]['best_effort_timestamp_time'])*1000))
  row={'source_frame':i+1,'source_pts_s':float(pts[i]['best_effort_timestamp_time']),'image_size_wh':[w,h],'mediapipe':None,'rtmpose':None}
  if result.pose_landmarks:
   lm=result.pose_landmarks[0];row['mediapipe']=[{'x':p.x*w,'y':p.y*h,'z_normalized':p.z,'visibility':p.visibility,'presence':p.presence} for p in lm]
   xy=np.array([[p.x*w,p.y*h] for p in lm]);box=np.r_[xy.min(0),xy.max(0)]
   k,s=rtm(rgb,bboxes=[box.tolist()]);assert np.isfinite(k).all() and np.isfinite(s).all()
   row['rtmpose']={'roi_xyxy':box.tolist(),'coco17_xy':k[0].tolist(),'scores':s[0].tolist(),'roi_source':'mediapipe_33_point_bounds'}
  rows.append(row)
  print(i+1,bool(result.pose_landmarks),flush=True)
cap.release()
(OUT/'observations.json').write_text(json.dumps(rows,indent=2))
report={'source_sha256':sha(video),'frames':len(rows),'mp_detected_frames':sum(r['mediapipe'] is not None for r in rows),'rtm_inferred_frames':sum(r['rtmpose'] is not None for r in rows),'versions':{p:importlib.metadata.version(p) for p in ['mediapipe','rtmlib','onnxruntime','opencv-contrib-python','numpy']},'weights_sha256':{'rtmpose':sha(weights),'mediapipe':sha('/opt/motion-pose-models/pose_landmarker_full.task')},'status':'REVIEW','limits':['No independent person detector; RTMPose ROI depends on MediaPipe','No ground truth, camera calibration, contact or 3D verification','Single pose assumption not independently validated']}
(OUT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
