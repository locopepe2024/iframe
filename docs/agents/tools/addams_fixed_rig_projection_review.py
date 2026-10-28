"""Optimistic screen-space scale/translation fit; not camera recovery."""
import json,math,statistics
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[3];BASE=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package';OUT=BASE/'addams-fixed-rig'
def main():
 d=json.loads((OUT/'fixed-rig-report.json').read_text());rows=[];sheet=Image.new('RGB',(960,3*285),'#222222');events=[6,10,14,18,22,24]
 for f in d['frames']:
  pairs=f['joints'];a=[statistics.mean(j['projected'][k] for j in pairs) for k in range(2)];b=[statistics.mean(j['source'][k] for j in pairs) for k in range(2)]
  den=sum(sum((j['projected'][k]-a[k])**2 for k in range(2)) for j in pairs)
  scale=max(0,sum(sum((j['projected'][k]-a[k])*(j['source'][k]-b[k]) for k in range(2)) for j in pairs)/den)
  aligned={j['name']:[(j['projected'][k]-a[k])*scale+b[k] for k in range(2)] for j in pairs}
  errors={j['name']:math.dist(aligned[j['name']],j['source']) for j in pairs}
  rows.append({'source_frame':f['source_frame'],'scale':scale,'translation_xy':[b[k]-a[k]*scale for k in range(2)],'per_joint_residual_px':errors,'mean_px':statistics.mean(errors.values())})
  if f['source_frame'] in events:
   im=Image.open(BASE/f'addams-pose-review/frames/frame-{f["source_frame"]:03}.jpg');dr=ImageDraw.Draw(im)
   for j in pairs:
    x,y=j['source'];dr.ellipse((x-4,y-4,x+4,y+4),outline='#ff9933',width=2)
    x,y=aligned[j['name']];dr.ellipse((x-4,y-4,x+4,y+4),outline='#33ff77',width=2)
   for side in ['left','right']:
    dr.line([tuple(aligned[side+'_'+j]) for j in ['hip','knee','ankle']],fill='#33ff77',width=3)
   i=events.index(f['source_frame']);sheet.paste(im.resize((480,260)),((i%2)*480,(i//2)*285+25));ImageDraw.Draw(sheet).text(((i%2)*480+5,(i//2)*285+5),f'{f["source_frame"]}: orange MP2D / green aligned fixed-rig',fill='white')
 report={'method':'per-frame positive uniform scale + translation, fit and score same6 joints; no rotation','units':'960x520 pixels','mean_per_frame_residual_median_px':statistics.median(r['mean_px'] for r in rows),'mean_per_frame_residual_max_px':max(r['mean_px'] for r in rows),'max_direction_error_deg':max(v['direction_error_deg'] for f in d['frames'] for v in f['directions']),'max_bone_length_delta_units':max(v['length_delta'] for f in d['frames'] for v in f['directions']),'rows':rows,'limits':['Optimistic in-sample fit, no held-out truth','Per-frame scale/translation do not recover source camera or world root','Source target is model estimate, not manual truth']}
 (OUT/'projection-review.json').write_text(json.dumps(report,indent=2)+'\n');sheet.save(OUT/'projection-review.jpg');print({k:v for k,v in report.items() if k not in ['rows','limits']})
if __name__=='__main__':main()
