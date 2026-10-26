"""Source image-only NCC shoe-front/light motion; no 3D camera inference."""
import argparse,hashlib,json,subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser();p.add_argument('--video',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
sha=hashlib.sha256(Path(a.video).read_bytes()).hexdigest();assert sha=='6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0'
raw=subprocess.run(['ffmpeg','-v','error','-i',a.video,'-vf','scale=697:396,format=gray','-frames:v','61','-fps_mode','passthrough','-f','rawvideo','-'],capture_output=True,check=True).stdout
frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,396,697).astype(np.float32);assert len(frames)==61
pts=json.loads(subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',a.video],capture_output=True,check=True).stdout)['frames']
def match(ref,im,x,y,hx,hy,sx,sy):
 template=ref[y-hy:y+hy,x-hx:x+hx];temp=template-template.mean();energy=np.sum(temp*temp)
 x0=max(hx,x-sx);x1=min(697-hx,x+sx);y0=max(hy,y-sy);y1=min(396-hy,y+sy)
 area=im[y0-hy:y1+hy,x0-hx:x1+hx]
 windows=np.lib.stride_tricks.sliding_window_view(area,template.shape)
 mean=windows.mean(axis=(-1,-2));energy2=np.sum(windows*windows,axis=(-1,-2))-mean*mean*template.size
 numerator=np.einsum('ijab,ab->ij',windows,temp,optimize=True)
 score=numerator/np.sqrt(np.maximum(energy2,0)*energy+1e-10)
 iy,ix=np.unravel_index(np.argmax(score),score.shape);cx=x0+int(ix);cy=y0+int(iy)
 return {'center_half':[cx,cy],'delta_full_px':[2*(cx-x),2*(cy-y)],'ncc':float(score[iy,ix]),'search_boundary':cx in (x0,x1) or cy in (y0,y1)}
lights={'left':(82,323),'middle':(216,323),'right':(523,323)};bg={}
for n in range(17,56):bg[n]={k:match(frames[0],frames[n-1],*xy,20,16,100,24) for k,xy in lights.items()}
def similarity(src,dst,point):
 mat=[];rhs=[]
 for (x,y),(u,v) in zip(src,dst):mat.extend([[x,-y,1,0],[y,x,0,1]]);rhs.extend([u,v])
 coef=np.linalg.lstsq(np.array(mat),np.array(rhs),rcond=None)[0];aa,bb,tx,ty=coef
 pred=np.array([[aa,-bb],[bb,aa]])@point+[tx,ty]
 residual=np.asarray(mat)@coef-rhs
 return pred,coef,float(np.sqrt(np.mean(residual**2)))
rows=[];sheet=Image.new('RGB',(1000,600),(20,20,20));draw=ImageDraw.Draw(sheet);tile=0
for first,last,center in [(17,37,(395,333)),(43,55,(300,340))]:
 for n in range(first,last+1):
  matches=[match(frames[first-1],frames[n-1],*center,hx,hy,30,12) for hx,hy in [(17,9),(20,12)]]
  src=[bg[first][k]['center_half'] for k in lights];dst=[bg[n][k]['center_half'] for k in lights]
  pred,coef,res=similarity(src,dst,np.array(center));pair_predictions=[similarity([src[i] for i in pair],[dst[i] for i in pair],np.array(center))[0] for pair in [(0,1),(0,2),(1,2)]];spread=max(float(np.linalg.norm(2*(u-v))) for u in pair_predictions for v in pair_predictions);shoe=np.array(matches[0]['center_half']);observed=2*(shoe-center);background=2*(pred-center)
  rows.append({'source_frame':n,'source_pts_s':float(pts[n-1]['best_effort_timestamp_time']),'window_first':first,'window_last':last,'shoe_reference_center_half':center,'shoe_matches':matches,'template_sensitivity_px':float(np.linalg.norm(np.array(matches[0]['delta_full_px'])-matches[1]['delta_full_px'])),'background_matches':bg[n],'similarity_coefficients':coef.tolist(),'light_fit_rmse_full_px':2*res,'leave_one_light_out_prediction_spread_px':spread,'observed_shoe_delta_px':observed.tolist(),'background_similarity_delta_at_shoe_px':background.tolist(),'shoe_minus_background_proxy_px':(observed-background).tolist()})
  if n in (first,first+2,(first+last)//2,last):
   im=Image.fromarray(frames[n-1].astype(np.uint8)).convert('RGB');dr=ImageDraw.Draw(im);cx,cy=matches[0]['center_half'];dr.rectangle((cx-17,cy-9,cx+17,cy+9),outline='red',width=1)
   crop=im.crop((center[0]-65,center[1]-40,center[0]+65,center[1]+35)).resize((250,150));xx=tile%4*250;yy=tile//4*200;sheet.paste(crop,(xx,yy+25));draw.text((xx+3,yy+3),f'frame {n} NCC {matches[0]["ncc"]:.3f}',fill='white');tile+=1
report={'schema':'recreation2-source-shoe-background.v1','video_sha256':sha,'resolution_half':[697,396],'rows':rows,'limits':['Visible frontal shoe patch, anatomical heel occluded','NCC template localization is not contact/force truth','Similarity from three near-collinear stage lights is only image-motion proxy','No metric floor/camera inference; no production changes']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');sheet.save(out/'shoe-match-overlays.png');print('SOURCE_SHOE_BACKGROUND_PASS',len(rows))
