"""Compare submitted human points against old projection and local candidates."""
import json,math,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
BASE=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-human-reviewed-v1'

def main():
 review=json.loads((OUT/'normalized.json').read_text());data=json.loads((OUT/'candidates.json').read_text());old=json.loads((BASE/'addams-fixed-rig/distributed-score.json').read_text());rows=[]
 cases=[('old_per_frame_depth',{r['source_frame']:r['predicted'] for r in old['rows'] if r['case']=='distributed_swing'})]
 cases += [(f"temporal_{c['temporal_weight']}",{f['source_frame']:f['projected'] for f in c['frames']}) for c in data['candidates']]
 sheet=Image.new('RGB',(1920,5*290),'#202126')
 for ci,(name,points) in enumerate(cases):
  for fi,f in enumerate(review['frames']):
   sf=f['source_frame'];pred=points[sf];errors={n:math.dist(j['xy_px'],pred[n]) for n,j in f['joints'].items() if j['visibility']=='visible'}
   rows.append({'case':name,'source_frame':sf,'visible_joint_errors_px':errors,'rmse_px':math.sqrt(sum(e*e for e in errors.values())/len(errors))})
   im=Image.open(BASE/f'addams-pose-review/frames/frame-{sf:03}.jpg').convert('RGB');d=ImageDraw.Draw(im)
   for side,color in [('left','#2dd4bf'),('right','#fb923c')]:
    d.line([tuple(pred[side+'_'+part]) for part in ['hip','knee','ankle']],fill=color,width=4)
   for n,j in f['joints'].items():
    x,y=j['xy_px'];color='white' if j['visibility']=='visible' else '#888888';d.ellipse((x-6,y-6,x+6,y+6),outline=color,width=2)
   sheet.paste(im.resize((480,260)),(ci*480,fi*290+30));ImageDraw.Draw(sheet).text((ci*480+5,fi*290+5),f"F{sf} {name} | RMSE {rows[-1]['rmse_px']:.1f}px",fill='white')
 summary={name:math.sqrt(sum(e*e for r in rows if r['case']==name for e in r['visible_joint_errors_px'].values())/sum(len(r['visible_joint_errors_px']) for r in rows if r['case']==name)) for name,_ in cases}
 # Compare annotations to source MP separately; human edits must not be silently treated as model output.
 observations={r['source_frame']:r for r in json.loads((BASE/'addams-pose-media/observations.json').read_text())}
 ids={'left_hip':23,'right_hip':24,'left_knee':25,'right_knee':26,'left_ankle':27,'right_ankle':28};edits=[]
 for f in review['frames']:
  for n,j in f['joints'].items():
   m=observations[f['source_frame']]['mediapipe'][ids[n]];edits.append({'source_frame':f['source_frame'],'joint':n,'visibility':j['visibility'],'human_minus_mp_px':math.dist(j['xy_px'],[m['x']/4,m['y']/4])})
 report={'units':'960x520 review pixels','visible_point_count':29,'summary_rmse_px':summary,'rows':rows,'human_edits':edits,
         'limits':['Fitting residual against submitted points, not independent accuracy.','Old baseline has per-frame depth; new candidates share frame21 depth.','No anatomical limits, mesh, contact or world-motion acceptance.','All five frames reviewed as right support; contact labels not yet enforced.'],
         'input_sha256':{n:hashlib.sha256((OUT/n).read_bytes()).hexdigest() for n in ['human-export.json','normalized.json','candidates.json']}}
 (OUT/'score.json').write_text(json.dumps(report,indent=2)+'\n');sheet.save(OUT/'comparison.jpg');print(json.dumps(summary,indent=2));print('largest_edits',sorted(edits,key=lambda r:r['human_minus_mp_px'],reverse=True)[:6])
if __name__=='__main__':main()
