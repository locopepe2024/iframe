import json,hashlib,zipfile
from pathlib import Path
import cv2,mediapipe as mp
from rtmlib import YOLOX,RTMPose
out=Path('/tmp/addams-pose'); models=Path('/opt/motion-pose-models')
with zipfile.ZipFile(models/'yolox.zip') as z:z.extractall(models/'yolox')
dw=next((models/'yolox').rglob('*.onnx'));pw=next((models/'rtmpose').rglob('end2end.onnx'))
det=YOLOX(str(dw),model_input_size=(640,640),backend='onnxruntime',device='cpu')
pose=RTMPose(str(pw),model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
opt=mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=str(models/'pose_landmarker_full.task')),running_mode=mp.tasks.vision.RunningMode.IMAGE,num_poses=1)
cap=cv2.VideoCapture(str(out/'source.mp4'));rows=[]
with mp.tasks.vision.PoseLandmarker.create_from_options(opt) as model:
 for i in range(50):
  ok,bgr=cap.read();assert ok
  rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB);boxes=det(bgr)
  row={'source_frame':i+1,'boxes_xyxy':boxes.tolist(),'rtmpose_people':[]}
  if len(boxes):
   k,s=pose(rgb,bboxes=boxes.tolist())
   row['rtmpose_people']=[{'coco17_xy':a.tolist(),'scores':b.tolist()} for a,b in zip(k,s)]
  if i+1 in [1,5,6,48,49,50]:
   res=model.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=rgb))
   row['mp_image_mode']=[[{'x':p.x*3840,'y':p.y*2080,'visibility':p.visibility} for p in person] for person in res.pose_landmarks]
  rows.append(row);print(i+1,len(boxes),flush=True)
cap.release()
report={'frames':rows,'detector_sha256':hashlib.sha256(dw.read_bytes()).hexdigest(),'detector_score_threshold':.7,'detector_input':'BGR per installed RTMLib YOLOX preprocessor','pose_input':'RGB per RTMPose pipeline','limits':['No identity tracker; each detection retained separately','No truth or 3D/contact validation','IMAGE mode tests only six specified frames']}
(out/'independent.json').write_text(json.dumps(report,indent=2))
