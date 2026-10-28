"""Explicit 25->30Hz nearest-frame mapping, lossless resized frames for CPU probe."""
import cv2,json,hashlib,subprocess
from pathlib import Path
B=Path('/tmp/addams-pose');O=B/'gvhmr-native-v1';O.mkdir(exist_ok=True)
source=B/'source.mp4';assert hashlib.sha256(source.read_bytes()).hexdigest()=='3b0d8f32549c80ef04e988c1bfe1393582fd6349047b306ce6c2df7bdae63c96'
c=cv2.VideoCapture(str(source));images={}
for sf in range(1,66):
 ok,img=c.read();assert ok
 if sf>=37:images[sf]=cv2.resize(img,(960,520),interpolation=cv2.INTER_AREA)
c.release();rows=[];P=O/'frames';P.mkdir(exist_ok=True)
for i in range(35):
 sf=min(65,37+int(i*25/30+.5));img=images[sf];path=P/f'{i:03}.png';assert cv2.imwrite(str(path),img)
 rows.append({'model_frame':i,'model_pts_s':i/30,'source_frame':sf,'source_pts_s':(sf-1)/25,'timing_error_s':(sf-37)/25-i/30,'bgr_sha256':hashlib.sha256(img.tobytes()).hexdigest()})
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-n','-framerate','30','-i',str(P/'%03d.png'),'-c:v','ffv1','-pix_fmt','bgr0',str(O/'input.mkv')],check=True)
c=cv2.VideoCapture(str(O/'input.mkv'))
for row in rows:
 ok,img=c.read();assert ok and hashlib.sha256(img.tobytes()).hexdigest()==row['bgr_sha256']
assert not c.read()[0];c.release()
(O/'frame-map.json').write_text(json.dumps({'source_fps':25,'model_fps':30,'source_range':[37,65],'resized_from':[3840,2080],'size':[960,520],'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'frames':rows,'limits':['Resampling duplicates nearest frames, creates no new motion evidence.','Static camera and default focal length are diagnostic hypotheses, not calibration.']},indent=2)+'\n');print('INPUT_VERIFIED',len(rows),len(set(r['source_frame'] for r in rows)),flush=True)
