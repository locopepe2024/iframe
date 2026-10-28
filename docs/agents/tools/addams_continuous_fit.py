"""Sparse whole-shot fixed-bone leg fit to reviewed skeletal points."""
import json,hashlib
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix
B=Path('/tmp/addams-pose');OUT=B/'continuous-shot1-v2';OUT.mkdir(exist_ok=True)
g=json.loads((B/'continuous-shot1-v1/geometry.json').read_text());review=json.loads((B/'reviewed-joints.json').read_text());scale=g['scale_review_px_per_unit'];names=[s+'_'+p for s in ['left','right'] for p in ['hip','knee','ankle']]
xyz=np.array([[f['xyz'][n] for n in names] for f in g['frames']]);hips=xyz[:,[0,3]];d=np.stack([xyz[:,1]-xyz[:,0],xyz[:,2]-xyz[:,1],xyz[:,4]-xyz[:,3],xyz[:,5]-xyz[:,4]],axis=1);lengths=np.linalg.norm(d,axis=-1);prior=d/lengths[:,:,None]
assert np.max(np.ptp(lengths,axis=0))<1e-5
initial=np.zeros((65,10));initial[:,:8:2]=np.unwrap(np.arctan2(prior[:,:,1],prior[:,:,0]),axis=0);initial[:,1:8:2]=np.arctan2(prior[:,:,2],np.hypot(prior[:,:,0],prior[:,:,1]))
def project(p):return np.stack([480+scale*p[:,:,0],260-scale*p[:,:,2]],axis=-1)
target=project(xyz);weights=np.full((65,6,1),1/40.);labels=[]
for f in review['frames']:
 for n,j in f['joints'].items():
  if j['visibility']=='visible' and j.get('semantic','joint')=='joint':
   i=f['source_frame']-1;k=names.index(n);target[i,k]=j['xy_px'];weights[i,k]=1/3.;labels.append((i,k,np.array(j['xy_px'])))
assert len(labels)==27

def geom(p):
 p=p.reshape(65,10);az=p[:,:8:2];el=p[:,1:8:2];dirs=np.stack([np.cos(el)*np.cos(az),np.cos(el)*np.sin(az),np.sin(el)],axis=-1);v=np.zeros((65,6,3));v[:,[0,3]]=hips
 for k in [0,1,2,3]:
  a=[0,1,3,4][k];b=a+1;v[:,b]=v[:,a]+dirs[:,k]*lengths[:,k,None]
 v[:,:,0]+=p[:,None,8]/scale;v[:,:,2]-=p[:,None,9]/scale
 return v,dirs

def residual(p):
 a=p.reshape(65,10);v,dirs=geom(p);block=np.concatenate([((project(v)-target)*weights).reshape(65,12),((dirs-prior)/.5).reshape(65,12),a[:,8:]/20.],axis=1)
 correction=a-initial;curvature=(correction[2:]-2*correction[1:-1]+correction[:-2]);curvature[:,:8]/=.15;curvature[:,8:]/=5
 return np.r_[block.ravel(),curvature.ravel()]
sp=lil_matrix((65*26+63*10,650),dtype=int)
for i in range(65):sp[i*26:(i+1)*26,i*10:(i+1)*10]=1
for i in range(63):sp[65*26+i*10:65*26+(i+1)*10,i*10:(i+3)*10]=1
lo=np.full((65,10),-np.inf);hi=-lo;lo[:,1:8:2]=-np.pi/2+1e-6;hi[:,1:8:2]=np.pi/2-1e-6
fit=least_squares(residual,initial.ravel(),jac_sparsity=sp.tocsr(),bounds=(lo.ravel(),hi.ravel()),max_nfev=250,ftol=1e-7,xtol=1e-7,gtol=1e-7)
v,dirs=geom(fit.x)
def metrics(v,dirs):
 pred=project(v);errs=[np.linalg.norm(pred[i,k]-xy) for i,k,xy in labels];steps=np.degrees(np.arccos(np.clip((dirs[1:]*dirs[:-1]).sum(-1),-1,1)))
 return {'human_27_point_rmse_review_px':float(np.sqrt(np.mean(np.square(errs)))),'max_leg_direction_step_deg':float(steps.max()),'max_leg_direction_step_frames18_27_deg':float(steps[17:27].max()),'human_frames':{str(sf):float(np.sqrt(np.mean([np.linalg.norm(pred[i,k]-xy)**2 for i,k,xy in labels if i==sf-1]))) for sf in range(20,25)}}
assert np.max(np.abs(np.linalg.norm(np.stack([v[:,1]-v[:,0],v[:,2]-v[:,1],v[:,4]-v[:,3],v[:,5]-v[:,4]],axis=1),axis=-1)-lengths))<1e-8
result={'schema':'addams-continuous-leg-fit.v2','optimizer_success':bool(fit.success),'message':fit.message,'nfev':fit.nfev,'baseline':metrics(xyz,prior),'fitted':metrics(v,dirs),'scale_review_px_per_unit':scale,'review_sha256':hashlib.sha256((B/'reviewed-joints.json').read_bytes()).hexdigest(),'frames':[{'source_frame':i+1,'xyz':{n:v[i,k].tolist() for k,n in enumerate(names)},'leg_directions_blender':dirs[i].tolist(),'root_delta_review_px':fit.x.reshape(65,10)[i,8:].tolist()} for i in range(65)],'limits':['In-sample residual only.','No physical shoe contact or gravity calibration.','Camera and baseline pelvis frozen; depth remains prior-conditioned.','Whole-shot soft regularization does not establish anatomical plausibility.','Frame24 hip contours excluded.']}
(OUT/'fit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['optimizer_success','nfev','baseline','fitted']},indent=2))
