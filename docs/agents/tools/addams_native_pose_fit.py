"""Key-frame-only SMPL pose upper bound; fixed camera candidate, no white-rig edits."""
import json
from pathlib import Path
import numpy as np
import torch
from hmr4d.utils.smplx_utils import make_smplx

B=Path('/tmp/addams-pose'); O=B/'gvhmr-native-v1'; inp=json.loads((O/'native-layer-input.json').read_text())
cam=json.loads((O/'camera-fit.json').read_text())['fits']['camera']; focal=cam['focal_px']; cx,cy=inp['camera_K'][0][2],inp['camera_K'][1][2]
names=['nose','left_eye','right_eye','left_ear','right_ear','left_shoulder','right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist','left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle']
mapping=inp['frame_map']['frames']; review=inp['review']; torch.set_num_threads(4)
pred=torch.load(O/'hmr4d_results.pt',map_location='cpu'); model=make_smplx('supermotion_v437coco17').eval()
betas=pred['smpl_params_incam']['betas'].detach(); body0=pred['smpl_params_incam']['body_pose'].detach().reshape(-1,21,3); glob0=pred['smpl_params_incam']['global_orient'].detach().reshape(-1,3); trans0=pred['smpl_params_incam']['transl'].detach().reshape(-1,3)
def project(j):
    z=j[...,2].clamp_min(1e-4); return torch.stack([focal*j[...,0]/z+cx,focal*j[...,1]/z+cy],-1)
pose_idx=[0,1,3,4,6,7,9,10]
rows=[]
for f in review['frames']:
    if f['status']!='reviewed' or f['identity']=='absent':continue
    ms=[r for r in mapping if r['source_frame']==f['source_frame']]
    if not ms:continue
    i=min(ms,key=lambda r:abs(r['timing_error_s']))['model_frame']; targets=[]
    for n,p in f['joints'].items():
        if n in names and p.get('confirmed') and p['visibility']=='visible' and p['semantic']=='joint':targets.append((names.index(n),torch.tensor(p['xy_px'],dtype=torch.float32)))
    if not targets:continue
    idx=torch.tensor([j for j,_ in targets],dtype=torch.long); y=torch.stack([v for _,v in targets]);
    dglob=torch.zeros(3,requires_grad=True); dbody=torch.zeros(len(pose_idx),3,requires_grad=True); dtrans=torch.zeros(3,requires_grad=True)
    opt=torch.optim.Adam([dglob,dbody,dtrans],lr=.025)
    with torch.no_grad():
        base_trans=torch.tensor(cam['translations'][str(i)],dtype=torch.float32)+trans0[i]
    for step in range(250):
        opt.zero_grad(); body=body0[i].clone(); body[pose_idx]+=dbody; glob=glob0[i]+dglob; trans=base_trans+dtrans
        _,j=model(body.reshape(1,1,21,3).reshape(1,1,63),betas[i].unsqueeze(0).unsqueeze(0),glob.unsqueeze(0).unsqueeze(0),trans.unsqueeze(0).unsqueeze(0)); predxy=project(j[0,0]); e=predxy[idx]-y
        loss=(e.square().sum(-1).sqrt()).mean()+.8*dbody.square().mean()+.8*dglob.square().mean()+.15*dtrans.square().mean(); loss.backward(); opt.step()
    with torch.no_grad():
        body=body0[i].clone(); body[pose_idx]+=dbody; glob=glob0[i]+dglob; trans=base_trans+dtrans
        _,j=model(body.reshape(1,1,21,3).reshape(1,1,63),betas[i].unsqueeze(0).unsqueeze(0),glob.unsqueeze(0).unsqueeze(0),trans.unsqueeze(0).unsqueeze(0)); q=project(j[0,0])[idx]; errs=(q-y).norm(dim=-1).numpy()
    with torch.no_grad():
        _,jb=model(body0[i].reshape(1,1,63),betas[i].unsqueeze(0).unsqueeze(0),glob0[i].unsqueeze(0).unsqueeze(0),base_trans.unsqueeze(0).unsqueeze(0)); bq=project(jb[0,0])[idx]; berr=(bq-y).norm(dim=-1).numpy()
    rows.append({'source_frame':f['source_frame'],'model_frame':i,'count':len(errs),'baseline_camera_rmse_px':float(np.sqrt(np.mean(berr**2))),'fitted_rmse_px':float(np.sqrt(np.mean(errs**2))),'fitted_median_px':float(np.median(errs)),'max_px':float(errs.max()),'delta_body_norm':float(dbody.detach().norm()),'delta_global_norm':float(dglob.detach().norm()),'delta_trans':dtrans.detach().tolist()})
out={'schema':'addams-native-pose-fit.v1','source_sha256':inp['frame_map']['source_sha256'],'focal_px':focal,'rows':rows,'limits':['Key-frame pose optimization is an optimistic upper bound, not accepted motion.','Only visible reviewed points drive each frame; no temporal smoothness or held-out validation.','SMPL-X betas and camera candidate are fixed; no white-rig edits or contact constraints.']}
(O/'pose-fit.json').write_text(json.dumps(out,indent=2)+'\n'); print(json.dumps(out,indent=2),flush=True)
