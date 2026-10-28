"""Fixed rotations and lengths; conditional focal/translation experiment, no camera truth."""
import json,math,statistics,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/addams-fixed-rig'

def fit(xy,xyz,focal,names):
 # For fixed tz, tx/ty have exact linear least-squares solutions.
 low=max(.05,-min(v[2] for v in xyz.values())+.05);high=100.
 def evaluate(logdepth):
  z=math.exp(logdepth);p={j:focal/(xyz[j][2]+z) for j in xyz}
  t=[sum(p[j]*(xy[j][k]-[480,260][k]-p[j]*xyz[j][k]) for j in names)/sum(p[j]**2 for j in names) for k in range(2)]
  pred={j:[p[j]*(xyz[j][k]+t[k])+[480,260][k] for k in range(2)] for j in xyz}
  err=sum(math.dist(pred[j],xy[j])**2 for j in names)
  return err,t+[z],pred
 grid=[math.log(low)+(math.log(high)-math.log(low))*i/120 for i in range(121)];idx=min(range(len(grid)),key=lambda i:evaluate(grid[i])[0]);a,b=grid[max(0,idx-1)],grid[min(120,idx+1)]
 for _ in range(65):
  l=a+(b-a)/3;r=b-(b-a)/3
  if evaluate(l)[0]<evaluate(r)[0]:b=r
  else:a=l
 e,t,p=evaluate((a+b)/2)
 return {'translation':t,'predicted':p,'fit_rmse_px':math.sqrt(e/len(names)),'depth_bound_hit':t[2]<low*1.01 or t[2]>high*.99,'positive_depth_min':min(v[2]+t[2] for v in xyz.values())}

def main():
 raw=json.loads((OUT/'camera-points.json').read_text());prior=json.loads((OUT/'fixed-rig-report.json').read_text());source={r['source_frame']:{j['name']:j['source'] for j in r['joints']} for r in prior['frames']}
 allnames=list(source[6]);fitnames=[n for n in allnames if not n.endswith('knee')];held=[n for n in allnames if n.endswith('knee')];cases={}
 for focal in [480.,960.,1440.,1920.]:
  rows=[]
  for r in raw['rows']:
   xy=source[r['source_frame']];xyz=r['xyz_right_down_forward'];item={'source_frame':r['source_frame']}
   for label,names in [('all6',allnames),('hips_ankles',fitnames)]:
    v=fit(xy,xyz,focal,names);v['knee_heldout_rmse_px']=math.sqrt(sum(math.dist(v['predicted'][n],xy[n])**2 for n in held)/2) if label=='hips_ankles' else None
    v['all6_mean_px']=statistics.mean(math.dist(v['predicted'][n],xy[n]) for n in allnames);item[label]=v
   rows.append(item)
  cases[str(focal)]={'rows':rows,'summary':{'all6_mean_px_median':statistics.median(r['all6']['all6_mean_px'] for r in rows),'held_knee_rmse_px_median':statistics.median(r['hips_ankles']['knee_heldout_rmse_px'] for r in rows),'fitted_depth_median':statistics.median(r['all6']['translation'][2] for r in rows),'bound_hits':sum(r[m]['depth_bound_hit'] for r in rows for m in ['all6','hips_ankles'])}}
 ortho=[]
 for r in raw['rows']:
  xy=source[r['source_frame']];xyz=r['xyz_right_down_forward'];a=[statistics.mean(xyz[n][k] for n in fitnames) for k in range(2)];b=[statistics.mean(xy[n][k] for n in fitnames) for k in range(2)]
  scale=max(0,sum((xyz[n][k]-a[k])*(xy[n][k]-b[k]) for n in fitnames for k in range(2))/sum((xyz[n][k]-a[k])**2 for n in fitnames for k in range(2)))
  err=math.sqrt(sum(sum(((xyz[n][k]-a[k])*scale+b[k]-xy[n][k])**2 for k in range(2)) for n in held)/2);ortho.append(err)
 # Synthetic recovery tests same algebra on known projected rigid points.
 xyz={'a':[-.2,0,.1],'b':[.2,.1,-.1],'c':[0,.4,.2],'d':[.1,-.2,0]};truth=[.15,-.1,4.];xy={j:[960*(v[k]+truth[k])/(v[2]+truth[2])+[480,260][k] for k in range(2)] for j,v in xyz.items()};test=fit(xy,xyz,960,list(xyz));assert test['fit_rmse_px']<1e-5,test
 report={'units':'960x520 pixels, cameraXYZ model units','focal_candidates_px':[480,960,1440,1920],'principal_point':[480,260],'scope':'19frames, frozen leg rotations/bone lengths/pelvis; per-frame translation refit','depth_search':'positive depth, tz in[max(.05,-minZ+.05),100], 121log-grid samples + local ternary refinement; not proof global minimum','input_sha256':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest() for name in ['camera-points.json','fixed-rig-report.json']},'orthographic_held_knee_rmse_px_median':statistics.median(ortho),'synthetic_rmse_px':test['fit_rmse_px'],'cases':cases,'limits':['Conditional fitting, not recovered source camera','All6 fit is in-sample; knee holdout uses other model joints, not manual truth','Camera orientation frozen; no originalL3 rig, root trajectory or contact validation']}
 (OUT/'perspective-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v['summary'] for k,v in cases.items()},indent=2))
if __name__=='__main__':main()
