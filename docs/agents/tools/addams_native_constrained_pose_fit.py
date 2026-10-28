"""Joint key-frame pose fit with bounded deltas and temporal smoothness."""
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
pose_idx=[0,1,3,4,6,7,9,10]
records=[]
for f in review['frames']:
    if f['status']!='reviewed' or f['identity']=='absent':continue
    ms=[r for r in mapping if r['source_frame']==f['source_frame']]
    if not ms:continue
    i=min(ms,key=lambda r:abs(r['timing_error_s']))['model_frame']; targets=[]
    for n,p in f['joints'].items():
        if n in names and p.get('confirmed') and p['visibility']=='visible' and p['semantic']=='joint':targets.append((names.index(n),p['xy_px']))
    if targets:records.append((i,torch.tensor([j for j,_ in targets]),torch.tensor([v for _,v in targets],dtype=torch.float32),f['source_frame']))
records.sort(); frames=[r[0] for r in records]; F=len(frames); fi={v:k for k,v in enumerate(frames)}
base_t=torch.tensor([cam['translations'][str(i)] for i in frames],dtype=torch.float32)+trans0[frames]
base_b=body0[frames].clone(); base_g=glob0[frames].clone(); base_beta=betas[frames].clone()
def project(j):
    z=j[...,2].clamp_min(1e-4); return torch.stack([focal*j[...,0]/z+cx,focal*j[...,1]/z+cy],-1)
def run(bound):
    dg=torch.zeros(F,3,requires_grad=True); db=torch.zeros(F,len(pose_idx),3,requires_grad=True); dt=torch.zeros(F,3,requires_grad=True)
    opt=torch.optim.Adam([dg,db,dt],lr=.02)
    for step in range(450):
        opt.zero_grad(); body=base_b.clone(); body[:,pose_idx]+=db; glob=base_g+dg; trans=base_t+dt
        _,j=model(body.reshape(1,F,63),base_beta.unsqueeze(0),glob.unsqueeze(0),trans.unsqueeze(0)); xy=project(j[0]); terms=[]
        for i,idx,y,_ in records: terms.append((xy[fi[i],idx]-y).square().sum(-1).sqrt().mean())
        terms.append(1.8*db.square().mean()); terms.append(1.8*dg.square().mean()); terms.append(.35*dt.square().mean())
        if F>2: terms.append(2.0*torch.diff(db,n=2,dim=0).square().mean()); terms.append(2.0*torch.diff(dg,n=2,dim=0).square().mean()); terms.append(.4*torch.diff(dt,n=2,dim=0).square().mean())
        loss=sum(terms); loss.backward(); opt.step()
        with torch.no_grad(): dg.clamp_(-bound,bound); db.clamp_(-bound,bound); dt.clamp_(-.5,.5)
    with torch.no_grad():
        body=base_b.clone(); body[:,pose_idx]+=db; glob=base_g+dg; trans=base_t+dt
        _,j=model(body.reshape(1,F,63),base_beta.unsqueeze(0),glob.unsqueeze(0),trans.unsqueeze(0)); xy=project(j[0])
    rows=[]; allerr=[]
    for i,idx,y,sf in records:
        e=(xy[fi[i],idx]-y).norm(dim=-1).numpy(); allerr.extend(e)
        rows.append({'source_frame':sf,'count':len(e),'rmse_px':float(np.sqrt(np.mean(e**2))),'median_px':float(np.median(e)),'max_px':float(e.max()),'delta_body_norm':float(db[fi[i]].norm()),'delta_global_norm':float(dg[fi[i]].norm()),'delta_translation':dt[fi[i]].tolist()})
    return {'bound_rad':bound,'overall_rmse_px':float(np.sqrt(np.mean(np.array(allerr)**2))),'overall_median_px':float(np.median(allerr)),'rows':rows}
out={'schema':'addams-native-constrained-pose-fit.v1','source_sha256':inp['frame_map']['source_sha256'],'focal_px':focal,'frames':frames,'annotation_count':sum(len(r[1]) for r in records),'fits':[run(.5),run(.8)],'limits':['Joint fit only over reviewed visible points; no held-out frames.','SMPL-X shape and camera candidate fixed.','Bounds are diagnostic choices, not learned anatomical limits.','No floor, contact, world trajectory, lighting or white-rig export.']}
(O/'constrained-pose-fit.json').write_text(json.dumps(out,indent=2)+'\n'); print(json.dumps(out,indent=2),flush=True)
