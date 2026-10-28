"""Keep hips/ankles fitting fixed; audit knees and shoulders as held-out points."""
import json,math,statistics
from pathlib import Path
from PIL import Image,ImageDraw
from addams_perspective_probe import fit
ROOT=Path(__file__).resolve().parents[3];BASE=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package';OUT=BASE/'addams-fixed-rig'
def main():
 data=json.loads((OUT/'chest-control.json').read_text());prior=json.loads((OUT/'pelvis-shoulder-control.json').read_text());obs={r['source_frame']:r['mediapipe'] for r in json.loads((BASE/'addams-pose-media/observations.json').read_text())};old={(r['case'],r['source_frame']):r for r in prior['rows']};rows=[];gaps=[]
 for r in data['rows']:
  sf=r['source_frame'];xyz=r['xyz_right_down_forward'];xy={}
  for side,indices in [('left',[23,25,27,11]),('right',[24,26,28,12])]:
   for part,j in zip(['hip','knee','ankle','shoulder'],indices):xy[side+'_'+part]=[obs[sf][j]['x']/4,obs[sf][j]['y']/4]
  for n,p in old['hip_axis',sf]['xyz_right_down_forward'].items():
   if not n.endswith('shoulder'):gaps.append(math.dist(xyz[n],p))
  train=[n for n in xy if n.endswith(('hip','ankle'))];v=fit(xy,xyz,960,train);err={n:math.dist(v['predicted'][n],p) for n,p in xy.items()}
  rows.append({'case':r['case'],'source_frame':sf,'per_joint_error_px':err,'predicted':v['predicted'],'source':xy,'translation':v['translation'],'depth_bound_hit':v['depth_bound_hit'],'knee_rmse_px':math.sqrt(sum(e*e for n,e in err.items() if n.endswith('knee'))/2),'shoulder_rmse_px':math.sqrt(sum(e*e for n,e in err.items() if n.endswith('shoulder'))/2),'train_rmse_px':v['fit_rmse_px']})
 assert max(gaps)<1e-5
 summary={case:{key:statistics.median(r[key] for r in rows if r['case']==case) for key in ['knee_rmse_px','shoulder_rmse_px','train_rmse_px']} for case in ['hip_axis','hip_axis_chest']}
 events=[6,9,10,11,12,18,24];sheet=Image.new('RGB',(960,len(events)*285),'#222222')
 for i,sf in enumerate(events):
  for j,case in enumerate(summary):
   r=next(r for r in rows if r['case']==case and r['source_frame']==sf);im=Image.open(BASE/f'addams-pose-review/frames/frame-{sf:03}.jpg');d=ImageDraw.Draw(im)
   for name,p in r['source'].items():
    x,y=p;d.ellipse((x-4,y-4,x+4,y+4),outline='orange',width=2)
   for side in ['left','right']:
    d.line([tuple(r['predicted'][side+'_'+part]) for part in ['shoulder','hip','knee','ankle']],fill='#33ff77',width=3)
   sheet.paste(im.resize((480,260)),(j*480,i*285+25));ImageDraw.Draw(sheet).text((j*480+4,i*285+5),f'{sf} {case} | knee{r["knee_rmse_px"]:.1f} shoulder{r["shoulder_rmse_px"]:.1f}',fill='white')
 sheet.save(OUT/'chest-review.jpg')
 report={'focal_px':960,'units':'960x520 pixels','fit':'hips+ankles only, per-frame translation','heldout':['knees','shoulders'],'leg_points_roundtrip_max_delta':max(gaps),'summary':summary,'rows':rows,'limits':['Only spine_chest aims at source shoulder-midpoint minus hip-midpoint; other spine/clavicle channels unchanged','Source shoulders used to construct chest target; excluded only from translation fit, not independent validation','Source MP points are not manual truth','No contact, world root or originalL3 rig validation']}
 (OUT/'chest-score.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(summary,indent=2))
 for sf in [6,9,10,11,12]:
  print(sf,[(r['case'],round(r['train_rmse_px'],2),round(r['knee_rmse_px'],2),round(r['shoulder_rmse_px'],2)) for r in rows if r['source_frame']==sf])
if __name__=='__main__':main()
