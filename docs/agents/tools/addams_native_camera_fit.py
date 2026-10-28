"""Fit camera-only and camera+uniform-scale upper bounds to native GVHMR joints."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
import torch
from hmr4d.utils.smplx_utils import make_smplx

B=Path('/tmp/addams-pose'); O=B/'gvhmr-native-v1'
inp=json.loads((O/'native-layer-input.json').read_text())
review=inp['review']; mapping=inp['frame_map']['frames']; W,H=inp['frame_map']['size']
names=['nose','left_eye','right_eye','left_ear','right_ear','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle']
torch.set_num_threads(4)
pred=torch.load(O/'hmr4d_results.pt',map_location='cpu')
params={k:v[None] for k,v in pred['smpl_params_incam'].items()}
with torch.inference_mode():
    model=make_smplx('supermotion_v437coco17').eval(); _,joints=model(**params)
xyz=joints[0].numpy()
ann=[]
for f in review['frames']:
    if f['status']!='reviewed' or f['identity']=='absent': continue
    rows=[r for r in mapping if r['source_frame']==f['source_frame']]
    if not rows: continue
    i=min(rows,key=lambda r:abs(r['timing_error_s']))['model_frame']
    for n,p in f['joints'].items():
        if n in names and p.get('confirmed') and p['visibility']=='visible' and p['semantic']=='joint':
            ann.append((i,names.index(n),np.array(p['xy_px'],float)))
frames=sorted({i for i,_,_ in ann}); fi={f:k for k,f in enumerate(frames)}
K0=np.array(inp['camera_K'],float); f0=float(K0[0,0]); cx,cy=K0[0,2],K0[1,2]
def project(p,f,trans,scale):
    q=scale*p+trans; z=np.maximum(q[:,2],1e-4)
    return np.c_[f*q[:,0]/z+cx,f*q[:,1]/z+cy]
def residual(v, mode):
    f=np.exp(v[0]); off=1
    s=np.exp(v[off]) if mode=='camera-scale' else 1.; off+=mode=='camera-scale'
    t=v[off:].reshape(len(frames),3); out=[]
    for i,j,target in ann:
        q=project(xyz[i,[j]],f,t[fi[i]],s)[0]; out.extend((q-target)/4.)
    out.extend((t[:,0:2]/1.5).ravel()); out.extend((t[:,2]/3.).ravel())
    if mode=='camera-scale': out.append(np.log(s)/.35)
    return np.array(out)
def metrics(v,mode):
    f=np.exp(v[0]); off=1; s=np.exp(v[off]) if mode=='camera-scale' else 1.; off+=mode=='camera-scale'; t=v[off:].reshape(len(frames),3)
    e=[]
    for i,j,target in ann: e.append(np.linalg.norm(project(xyz[i,[j]],f,t[fi[i]],s)[0]-target))
    e=np.array(e)
    return {'focal_px':float(f),'scale':float(s),'count':len(e),'rmse_px':float(np.sqrt(np.mean(e*e))), 'median_px':float(np.median(e)), 'p90_px':float(np.percentile(e,90)), 'max_px':float(e.max()), 'translations':{str(frame):t[fi[frame]].tolist() for frame in frames}}
reports={}
for mode in ['baseline','camera','camera-scale']:
    x=np.zeros(1+(mode=='camera-scale')+3*len(frames)); x[0]=np.log(f0)
    if mode=='camera-scale': x[1]=0
    if mode=='baseline': reports[mode]=metrics(x,mode); continue
    result=least_squares(lambda v:residual(v,mode),x,max_nfev=1200,ftol=1e-10,xtol=1e-10,gtol=1e-10)
    reports[mode]={**metrics(result.x,mode),'success':bool(result.success),'nfev':int(result.nfev),'cost':float(result.cost)}
out={'schema':'addams-native-camera-fit.v1','source_sha256':inp['frame_map']['source_sha256'],'frames':frames,'annotation_count':len(ann),'baseline_camera':{'focal_px':f0,'principal':[cx,cy]},'fits':reports,'limits':['Same native GVHMR pose and body shape; no manual pose correction.','Per-frame translation makes this an optimistic upper-bound diagnostic.','Focal/scale remain gauge-coupled without measured body size or camera calibration.','No world trajectory, ground or foot contact validation.']}
(O/'camera-fit.json').write_text(json.dumps(out,indent=2)+'\n'); print(json.dumps(reports,indent=2),flush=True)
