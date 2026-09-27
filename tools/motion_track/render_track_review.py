import argparse,json,math
from pathlib import Path
import cv2

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--video',required=True); ap.add_argument('--track',required=True); ap.add_argument('--out',required=True); ap.add_argument('--columns',type=int,default=3); ap.add_argument('--max-samples',type=int,default=12); args=ap.parse_args()
 track=json.loads(Path(args.track).read_text()); frames=track['frames']; cap=cv2.VideoCapture(args.video)
 if not cap.isOpened(): raise SystemExit('cannot open video')
 by_frame={int(f['frame']):f for f in frames}; picks=[]
 for f in frames:
  if len(picks)>=args.max_samples: break
  if not picks or f['frame']-picks[-1]['frame']>=max(1, len(frames)//args.max_samples): picks.append(f)
 tiles=[]
 for f in picks:
  cap.set(cv2.CAP_PROP_POS_FRAMES,int(f['frame'])-1); ok,img=cap.read()
  if not ok: continue
  h,w=img.shape[:2]; bbox=f.get('target_bbox'); status=f.get('selection_status','unknown')
  color=(0,190,255) if status=='tracked' else (0,0,255)
  if bbox:
   x0,y0,x1,y1=bbox; cv2.rectangle(img,(int(x0*w),int(y0*h)),(int(x1*w),int(y1*h)),color,4)
  cv2.rectangle(img,(0,0,w,62),(0,0,0),-1)
  cv2.putText(img,f"source frame {f['frame']}  poses={f.get('subject_count')}  target={status}",(18,40),cv2.FONT_HERSHEY_SIMPLEX,1.0,color,2)
  scale=min(480/w,300/h); img=cv2.resize(img,(int(w*scale),int(h*scale)))
  tiles.append(img)
 cap.release()
 if not tiles: raise SystemExit('no frames rendered')
 tw=max(x.shape[1] for x in tiles); th=max(x.shape[0] for x in tiles); rows=math.ceil(len(tiles)/args.columns); sheet=255*__import__('numpy').ones((rows*th,args.columns*tw,3),dtype='uint8')
 for i,t in enumerate(tiles): sheet[i//args.columns*th:i//args.columns*th+t.shape[0],i%args.columns*tw:i%args.columns*tw+t.shape[1]]=t
 out=Path(args.out); out.parent.mkdir(parents=True,exist_ok=True); cv2.imwrite(str(out),sheet); print(json.dumps({'out':str(out),'samples':len(tiles),'size':[int(sheet.shape[1]),int(sheet.shape[0])]}))
if __name__=='__main__': main()
