"""Cut-reset MP plus independent detector/pose; no implicit identity assignment."""
import json,hashlib,time,subprocess,importlib.metadata
from pathlib import Path
import cv2,mediapipe as mp,numpy as np
from rtmlib import YOLOX,RTMPose
BASE=Path('/tmp/addams-pose');OUT=BASE/'segment-batch-v1';OUT.mkdir(exist_ok=True)
MODELS=Path('/opt/motion-pose-models');video=BASE/'source.mp4'
dw=next((MODELS/'yolox').rglob('*.onnx'));pw=next((MODELS/'rtmpose').rglob('end2end.onnx'));mw=MODELS/'pose_landmarker_full.task'
det=YOLOX(str(dw),model_input_size=(640,640),backend='onnxruntime',device='cpu')
rtm=RTMPose(str(pw),model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
options=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(mw)),running_mode=mp.tasks.vision.RunningMode.VIDEO,num_poses=2)
pts=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(video)]))['frames']
segments=[{'id':'shot1','first_frame':1,'last_frame':65},{'id':'shot2','first_frame':66,'last_frame':158},{'id':'shot3','first_frame':159,'last_frame':217}]
cap=cv2.VideoCapture(str(video));rows=[];started=time.time();model=None
try:
 for i,fr in enumerate(pts):
  sf=i+1;ok,bgr=cap.read();assert ok
  seg=next(s for s in segments if s['first_frame']<=sf<=s['last_frame'])
  if sf==seg['first_frame']:
   if model:model.close()
   model=mp.tasks.vision.PoseLandmarker.create_from_options(options)
  rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB);h,w=bgr.shape[:2];t=float(fr['best_effort_timestamp_time'])
  result=model.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb),round(t*1000));boxes=det(bgr);people=[]
  if len(boxes):
   keypoints,scores=rtm(rgb,bboxes=boxes.tolist())
   assert np.isfinite(keypoints).all() and np.isfinite(scores).all()
   people=[{'box_xyxy':box.tolist(),'coco17_xy':k.tolist(),'scores':s.tolist(),'identity':'unassigned'} for box,k,s in zip(boxes,keypoints,scores)]
  mp_people=[{'landmarks':[{'x':p.x*w,'y':p.y*h,'visibility':p.visibility} for p in lm],
              'world_landmarks':[{'x':p.x,'y':p.y,'z':p.z,'visibility':p.visibility} for p in world],
              'identity':'unassigned'} for lm,world in zip(result.pose_landmarks,result.pose_world_landmarks)]
  rows.append({'source_frame':sf,'pts_s':t,'segment_id':seg['id'],'image_size':[w,h],'independent_people':people,'mp_people':mp_people})
  if sf%25==0:print(sf,'detector',len(people),'mp',len(mp_people),flush=True)
finally:
 cap.release()
 if model:model.close()
report={'schema':'addams-segment-batch.v1','segments':segments,'frame_count':len(rows),'runtime_seconds':time.time()-started,
        'source_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'weights_sha256':{n:hashlib.sha256(p.read_bytes()).hexdigest() for n,p in [('yolox',dw),('rtmpose',pw),('mp',mw)]},
        'versions':{p:importlib.metadata.version(p) for p in ['mediapipe','rtmlib','onnxruntime']},
        'summary':[{**s,'mp_any':sum(bool(r['mp_people']) for r in rows if r['segment_id']==s['id']),
                    'independent_any':sum(bool(r['independent_people']) for r in rows if r['segment_id']==s['id']),
                    'independent_multiple':sum(len(r['independent_people'])>1 for r in rows if r['segment_id']==s['id'])} for s in segments],
        'limits':['Detection/proposals do not identify the protagonist.','Detector threshold/defaults unchanged; no interpolated detections.','MP reset only at visually checked cuts66/159, not motion/flash candidates.','RTMPose2D and MPworld remain estimates; no camera/contact/rig acceptance.']}
(OUT/'observations.json').write_text(json.dumps(rows,indent=2)+'\n');(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
