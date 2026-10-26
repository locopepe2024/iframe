"""Read-only floor-near template identifiability; no camera/ground inference."""
import argparse,hashlib,json,subprocess,itertools
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
p=argparse.ArgumentParser();p.add_argument('--video',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
sha=hashlib.sha256(Path(a.video).read_bytes()).hexdigest();assert sha=='6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0'
raw=subprocess.run(['ffmpeg','-v','error','-i',a.video,'-vf','scale=697:396,format=gray','-frames:v','61','-fps_mode','passthrough','-f','rawvideo','-'],capture_output=True,check=True).stdout
frames=np.frombuffer(raw,dtype=np.uint8).reshape(-1,396,697).astype(np.float64);assert len(frames)==61
pts=json.loads(subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',a.video],capture_output=True,check=True).stdout)['frames']
centers=list(itertools.product([120,220,480,580],[337,352]))
def match(ref,im,center,hx,hy):
 x,y=center;template=ref[y-hy:y+hy,x-hx:x+hx];temp=template-template.mean();energy=np.sum(temp**2)
 x0=max(hx,x-40);x1=min(697-hx,x+40);y0=max(hy,y-12);y1=min(396-hy,y+12)
 windows=np.lib.stride_tricks.sliding_window_view(im[y0-hy:y1+hy,x0-hx:x1+hx],template.shape)
 mean=windows.mean(axis=(-1,-2));var=np.maximum(np.sum(windows*windows,axis=(-1,-2))-mean**2*template.size,0)
 score=np.einsum('ijab,ab->ij',windows,temp,optimize=True)/np.sqrt(var*energy+1e-12)
 iy,ix=np.unravel_index(np.argmax(score),score.shape);cx=x0+int(ix);cy=y0+int(iy)
 yy,xx=np.indices(score.shape);mask=(xx-ix)**2+(yy-iy)**2>4**2
 other=float(np.max(score[mask]));peak=float(score[iy,ix])
 return dict(center=[cx,cy],ncc=peak,alternative_ncc=other,peak_gap=peak-other,template_std=float(template.std()),boundary=cx in (x0,x1) or cy in (y0,y1))
def fit(src,dst,point,kind):
 src=np.asarray(src,float);dst=np.asarray(dst,float)
 if kind=='affine':
  design=np.column_stack((src,np.ones(len(src))));coef,_,rank,sing=np.linalg.lstsq(design,dst,rcond=None);pred=np.r_[point,1]@coef;fitted=design@coef
 else:
  design=np.array([[v for v in row] for x,y in src for row in ([x,-y,1,0],[y,x,0,1])]);coef,_,rank,sing=np.linalg.lstsq(design,dst.ravel(),rcond=None);aa,bb,tx,ty=coef;pred=np.array([[aa,-bb],[bb,aa]])@point+[tx,ty];fitted=(design@coef).reshape(-1,2)
 return {'prediction_half':pred.tolist(),'rank':int(rank),'singular_values':sing.tolist(),'train_rmse_full_px':float(2*np.sqrt(np.mean((fitted-dst)**2)))}
rows=[]
for first,sequence,shoe in [(17,[17,23,29,37],[395,333]),(43,[43,47,51,55],[300,340])]:
 for n in sequence:
  patches=[]
  for center in centers:
   m=match(frames[first-1],frames[n-1],center,16,7);m2=match(frames[first-1],frames[n-1],center,20,9)
   backward=match(frames[n-1],frames[first-1],m['center'],16,7);cycle=float(2*np.linalg.norm(np.array(backward['center'])-center));sens=float(2*np.linalg.norm(np.array(m['center'])-m2['center']))
   accepted=m['ncc']>=.85 and m['peak_gap']>=.02 and cycle<=2 and sens<=4 and not m['boundary']
   patches.append(dict(reference_center_half=center,match=m,second_template=m2,cycle_full_px=cycle,template_sensitivity_full_px=sens,accepted=accepted))
  good=[r for r in patches if r['accepted']];models={}
  if len(good)>=4 and len({r['reference_center_half'][1] for r in good})==2:
   src=[r['reference_center_half'] for r in good];dst=[r['match']['center'] for r in good]
   for kind in ['similarity','affine']:
    model=fit(src,dst,shoe,kind);loo=[];errors=[]
    for i in range(len(src)):
     inds=[j for j in range(len(src)) if i!=j];ss=[src[j] for j in inds];dd=[dst[j] for j in inds]
     m0=fit(ss,dd,shoe,kind);loo.append(m0['prediction_half']);mi=fit(ss,dd,src[i],kind);errors.append(float(2*np.linalg.norm(np.array(mi['prediction_half'])-dst[i])))
    model['loo_rank_degenerate_count']=sum(fit([src[j] for j in range(len(src)) if j!=i],[dst[j] for j in range(len(dst)) if j!=i],shoe,kind)['rank'] < (3 if kind=='affine' else 4) for i in range(len(src)));model['loo_prediction_spread_full_px']=max(float(2*np.linalg.norm(np.array(u)-v)) for u in loo for v in loo);model['loo_held_out_errors_full_px']=errors;models[kind]=model
  rows.append(dict(source_frame=n,source_pts_s=float(pts[n-1]['best_effort_timestamp_time']),reference_frame=first,patches=patches,accepted_count=len(good),models=models))
report=dict(schema='recreation2-floor-patch-identifiability.v1',source_sha256=sha,gate=dict(ncc_min=.85,peak_gap_min=.02,cycle_max_full_px=2,template_sensitivity_max_full_px=4,require_no_boundary=True),rows=rows,limits=['Floor-near image regions not certified physical plane','Gate is engineering heuristic, not statistical confidence','No camera/ground/world contact recovery'])
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
sheet=Image.new('RGB',(1394,792))
for i,n in enumerate([17,43]):
 im=Image.fromarray(frames[n-1].astype(np.uint8)).convert('RGB');d=ImageDraw.Draw(im)
 for j,(x,y) in enumerate(centers):d.rectangle((x-16,y-7,x+16,y+7),outline='red');d.text((x-16,y-18),str(j),fill='yellow')
 d.text((10,10),f'source {n}; half resolution',fill='yellow');sheet.paste(im,(i*697,0))
sheet=sheet.crop((0,0,1394,396));sheet.save(out/'regions.png')
print('FLOOR_PATCH_IDENTIFIABILITY_PASS',[(r['source_frame'],r['accepted_count']) for r in rows])
