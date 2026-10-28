import json,hashlib
from pathlib import Path
import cv2,numpy as np
from rtmlib import RTMPose
out=Path('/tmp/addams-pose');prior=json.loads((out/'independent.json').read_text());w=next(Path('/opt/motion-pose-models/rtmpose').rglob('end2end.onnx'))
m=RTMPose(str(w),model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
cap=cv2.VideoCapture(str(out/'source.mp4'));rows=[]
for i in range(50):
 ok,img=cap.read();assert ok
 if i+1 not in [37,38,43,49]:continue
 f=next(r for r in prior['frames'] if r['source_frame']==i+1);variants={}
 for idx,b in enumerate(f['boxes_xyxy']):
  for scale in [1.,1.2]:
   b=np.array(b);c=(b[:2]+b[2:])/2;half=(b[2:]-b[:2])*scale/2;box=np.r_[c-half,c+half]
   k,s=m(cv2.cvtColor(img,cv2.COLOR_BGR2RGB),bboxes=[box.tolist()]);label=f'box{idx}_scale{scale}'
   variants[label]={'box_xyxy':box.tolist(),'xy':k[0].tolist(),'scores':s[0].tolist()}
   if scale==1.:assert np.max(np.abs(k[0]-np.array(f['rtmpose_people'][idx]['coco17_xy'])))<.01
 rows.append({'source_frame':i+1,'variants':variants})
cap.release()
(out/'roi-control.json').write_text(json.dumps({'weight_sha256':hashlib.sha256(w.read_bytes()).hexdigest(),'baseline_reproduced_tolerance_native_px':.01,'rows':rows,'limits':['Expansion20% declared in advance','No clipping expanded ROI to image; RTMLib affine border padding','No ground truth or automatic candidate selection']},indent=2))
