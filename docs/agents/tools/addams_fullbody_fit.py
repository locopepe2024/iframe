"""Fit reviewed visible joints with full hierarchical FK; retain camera and rest rig."""
import json, hashlib
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation
from scipy.sparse import lil_matrix
B=Path('/tmp/addams-pose'); O=B/'fullbody-reviewed-v1'; O.mkdir(exist_ok=True)
d=json.loads((B/'fullbody-fk.json').read_text()); review=json.loads((B/'fullbody-reviewed-input.json').read_text())
frames=d['frames']; F=len(frames); scale=d['scale']; names=d['names']; bones=d['bones']
joint_bones={s+'_'+p:b+'_'+suffix for s,suffix in [('left','l'),('right','r')] for p,b in [('shoulder','upper_arm'),('elbow','lower_arm'),('wrist','wrist'),('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]}
active=['pelvis','spine_lower','spine_mid','spine_chest','clavicle_l','clavicle_r','upper_arm_l','upper_arm_r','lower_arm_l','lower_arm_r','upper_leg_l','upper_leg_r','lower_leg_l','lower_leg_r']; A=len(active); D=A*3+2
needed=set(joint_bones.values())
for n in list(needed):
 p=bones[n]['parent']
 while p:needed.add(p);p=bones[p]['parent']
order=[n for n in names if n in needed]; rests={n:np.array(bones[n]['rest']) for n in order}; rel={n:np.linalg.inv(rests[bones[n]['parent']])@rests[n] if bones[n]['parent'] else rests[n] for n in order}
basis={n:np.array([f['basis'][n] for f in frames]) for n in order}; world=np.array([f['arm_world'] for f in frames]); targets=[]
for f in review['frames']:
 if f['status']!='reviewed' or f['identity']=='absent':continue
 for n,p in f['joints'].items():
  if p.get('confirmed') and p['visibility']=='visible' and p['semantic']=='joint' and n in joint_bones:
   targets.append((next(i for i,v in enumerate(frames) if v['source_frame']==f['source_frame']),n,np.array(p['xy_px'])))
def fk(x):
 x=x.reshape(F,D); rot=Rotation.from_rotvec(x[:,:A*3].reshape(-1,3)).as_matrix().reshape(F,A,3,3); pose={}
 for n in order:
  m=basis[n].copy()
  if n in active:m[:,:3,:3]=m[:,:3,:3]@rot[:,active.index(n)]
  local=rel[n]@m; p=bones[n]['parent'];pose[n]=pose[p]@local if p else local
 points={n:(world@pose[b])[:,:3,3].copy() for n,b in joint_bones.items()}
 for v in points.values():v[:,0]+=x[:,-2]/scale;v[:,2]-=x[:,-1]/scale
 return points
zero=np.zeros((F,D)); initial=fk(zero)
max_fk=max(np.max(np.abs(initial[n][i]-(world[i]@np.array(f['pose'][b]))[:3,3])) for n,b in joint_bones.items() for i,f in enumerate(frames));assert max_fk<1e-5,max_fk
def project(p):return np.array([480+scale*p[0],260-scale*p[2]])
def residual(x):
 a=x.reshape(F,D);pts=fk(x);measure=np.concatenate([(project(pts[n][i])-v)/4 for i,n,v in targets]);prior=a.copy();prior[:,:A*3]/=.75;prior[:,-2:]/=100
 smooth=np.diff(a,n=2,axis=0);smooth[:,:A*3]/=.3;smooth[:,-2:]/=15
 return np.r_[measure,prior.ravel(),smooth.ravel(),(a[[0,-1]]*10).ravel()]
size=len(residual(zero));sp=lil_matrix((size,F*D));r=0
for i,n,v in targets:sp[r:r+2,i*D:(i+1)*D]=1;r+=2
for i in range(F):sp[r:r+D,i*D:(i+1)*D]=1;r+=D
for i in range(F-2):sp[r:r+D,i*D:(i+3)*D]=1;r+=D
for i in [0,F-1]:sp[r:r+D,i*D:(i+1)*D]=1;r+=D
start=zero.copy()
if (O/"fit.json").exists():
 old=json.loads((O/"fit.json").read_text())
 for i,f in enumerate(old["frames"]):start[i]=np.r_[np.array(f["rotation_deltas"]).ravel(),f["root_delta_px"]]
fit=least_squares(residual,start.ravel(),jac_sparsity=sp.tocsr(),max_nfev=600,ftol=1e-6,xtol=1e-6,gtol=1e-6)
pts=fk(fit.x)
def metrics(p):
 e=[float(np.linalg.norm(project(p[n][i])-v)) for i,n,v in targets];return {'point_count':len(e),'rmse_px':float(np.sqrt(np.mean(np.square(e)))),'by_frame':{str(frames[i]['source_frame']):float(np.sqrt(np.mean([np.linalg.norm(project(p[n][j])-v)**2 for j,n,v in targets if j==i]))) for i in sorted(set(t[0] for t in targets))}}
out={'schema':'addams-fullbody-reviewed-fit.v1','optimizer_success':bool(fit.success),'message':fit.message,'nfev':fit.nfev,'fk_baseline_max_error':float(max_fk),'baseline':metrics(initial),'fitted':metrics(pts),'active_bones':active,'scale':scale,'input_sha256':hashlib.sha256((B/'fullbody-reviewed-input.json').read_bytes()).hexdigest(),'frames':[{'source_frame':f['source_frame'],'rotation_deltas':fit.x.reshape(F,D)[i,:A*3].reshape(A,3).tolist(),'root_delta_px':fit.x.reshape(F,D)[i,-2:].tolist(),'xyz':{n:pts[n][i].tolist() for n in joint_bones}} for i,f in enumerate(frames)],'limits':['In-sample visible skeletal joints only; hidden/contour points excluded.','Fixed camera and bone lengths; depth depends on prior.','No shoe contact constraint or independent 3D acceptance.','Only frames48–59 modified; rest of shot remains baseline.']}
(O/'fit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:out[k] for k in ['optimizer_success','nfev','fk_baseline_max_error','baseline','fitted']},indent=2),flush=True)
