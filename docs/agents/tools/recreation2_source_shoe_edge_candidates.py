"""Read-only bright-shoe lower-edge sensitivity; candidate only."""
import argparse,json,hashlib,subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser();p.add_argument('--video',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
sha=hashlib.sha256(Path(a.video).read_bytes()).hexdigest();assert sha=='6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0'
frames=[1,17,23,29,41,55];raw=subprocess.run(['ffmpeg','-v','error','-i',a.video,'-vf','scale=1394:792,format=rgb24','-frames:v','61','-fps_mode','passthrough','-f','rawvideo','-'],capture_output=True,check=True).stdout
imgs=np.frombuffer(raw,dtype=np.uint8).reshape(61,792,1394,3);src=json.loads(Path(a.source).read_text())['rows'];src={r['frame']:r for r in src}
def comps(mask):
 h,w=mask.shape;seen=np.zeros_like(mask,bool);out=[]
 for y,x in zip(*np.where(mask)):
  if seen[y,x]:continue
  stack=[(int(y),int(x))];seen[y,x]=1;pts=[]
  while stack:
   yy,xx=stack.pop();pts.append((yy,xx))
   for dy in (-1,0,1):
    for dx in (-1,0,1):
     ny,nx=yy+dy,xx+dx
     if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:seen[ny,nx]=1;stack.append((ny,nx))
  if len(pts)>=5:out.append(pts)
 return sorted(out,key=len,reverse=True)
rows=[];sheet=Image.new('RGB',(1000,700),(18,18,18));draw=ImageDraw.Draw(sheet)
for ti,f in enumerate(frames):
 for si,side in enumerate(('left','right')):
  r=src[f][side];hx,hy=r['heel_xy_px'];tx,ty=r['toe_xy_px'];xmin=int(min(hx,tx)-55);xmax=int(max(hx,tx)+55);ymin=int(min(hy,ty)-35);ymax=int(max(hy,ty)+55);arr=imgs[f-1,ymin:ymax+1,xmin:xmax+1];gray=arr.mean(2);variants=[]
  for threshold in (120,150,180,200):
   cs=comps(gray>=threshold);best=max(cs,key=lambda c:(max(y for y,x in c),len(c))) if cs else []
   if best: by=[y for y,x in best];bottom=max(by)+ymin;spread=max(by)-min(by);area=len(best)
   else:bottom=None;spread=0;area=0
   variants.append({'threshold':threshold,'bottom_y_px':bottom,'component_area':area,'component_height':spread})
  vals=[v['bottom_y_px'] for v in variants if v['bottom_y_px'] is not None];rows.append({'source_frame':f,'side':side,'roi_xyxy':[xmin,ymin,xmax,ymax],'source_heel_toe':[[hx,hy],[tx,ty]],'variants':variants,'bottom_range_px':[min(vals),max(vals)] if vals else None,'bottom_spread_px':max(vals)-min(vals) if vals else None})
  im=Image.fromarray(arr).convert('RGB');d=ImageDraw.Draw(im);d.rectangle((0,0,im.width-1,im.height-1),outline='red');d.text((3,3),f'{f} {side}',fill='yellow');im.thumbnail((250,170));sheet.paste(im,(si*250,(ti//2)*170))
out/'report.json'
(out/'report.json').write_text(json.dumps({'schema':'recreation2-source-shoe-edge-candidate.v1','video_sha256':sha,'rows':rows,'limits':['Bright component is visible-shoe candidate, not physical sole/contact','Reflection, stage line and leg may connect or split components','No manual edge annotation or camera/ground inference','No production changes']},indent=2)+'\n');sheet.save(out/'edge-candidates.png');print('SHOE_EDGE_CANDIDATE_PASS',len(rows))
