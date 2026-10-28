"""Fixed-length local leg candidate conditioned on reviewed 2D points.

Requires numpy/scipy. Does not solve world motion, contacts, or camera calibration.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares


def unit(v):return v/np.linalg.norm(v)
def angles(v):return [math.atan2(v[2],v[0]),math.atan2(v[1],math.hypot(v[0],v[2]))]
def direction(a):return np.array([math.cos(a[1])*math.cos(a[0]),math.sin(a[1]),math.cos(a[1])*math.sin(a[0])])


def is_joint(j):
    # Legacy v1 Addams labels used joint-only semantics; product defaults differ.
    return j['visibility']=='visible' and j.get('semantic','joint')=='joint'


def solve(review,control,camera,rig,weights=(0,1,4)):
    frames=review['frames']
    if not review.get('solver_ready') or len(frames)!=5 or [f['source_frame'] for f in frames]!=list(range(20,25)):
        raise ValueError('Five submitted, reviewed frames20–24 required; predictions/pending frames cannot drive solve')
    if review.get('coordinate_space')!='review_image_pixels' or review.get('image_size')!=[960,520]:
        raise ValueError('Unsupported annotation coordinates')
    if any(f['status']!='reviewed' or sum(is_joint(j) for j in f['joints'].values())<4 for f in frames):
        raise ValueError('Each reviewed frame needs at least four visible skeletal joints')
    times=np.array([f['pts_s'] for f in frames]);dt=np.diff(times)
    if not np.allclose(dt,.04,atol=1e-9):raise ValueError('This diagnostic requires consecutive25fps PTS')
    raw={r['source_frame']:r for r in control['rows'] if r['case']=='distributed_swing'}
    cam={r['source_frame']:r for r in camera['rows'] if r['case']=='distributed_swing'}
    depth=cam[21]['translation'][2];focal=960.
    sides=['left','right'];parts=['hip','knee','ankle'];lengths=np.array([[rig['rest_lengths'][b+'_'+s] for b in ['upper_leg','lower_leg']] for s in ['l','r']])
    hips=np.array([[raw[f['source_frame']]['xyz_right_down_forward'][s+'_hip'] for s in sides] for f in frames])
    prior=[]
    for f in frames:
        xyz=raw[f['source_frame']]['xyz_right_down_forward'];prior.append([[unit(np.array(xyz[s+'_'+parts[j+1]])-xyz[s+'_'+parts[j]]).tolist() for j in range(2)] for s in sides])
    prior=np.array(prior);initial=np.zeros((5,10))
    for i,f in enumerate(frames):
        initial[i,:8]=np.array([[angles(v) for v in side] for side in prior[i]]).ravel()
        initial[i,8:]=cam[f['source_frame']]['translation'][:2]
    # Unwrap azimuths to avoid artificial2pi transitions at initialization.
    for col in [0,2,4,6]:initial[:,col]=np.unwrap(initial[:,col])
    visible=[(i,n,np.array(j['xy_px'])) for i,f in enumerate(frames) for n,j in f['joints'].items() if is_joint(j)]
    allowed={s+'_'+p for s in sides for p in parts}
    if any(n not in allowed or not np.all(np.isfinite(xy)) or np.any(xy<0) or xy[0]>960 or xy[1]>520 for _,n,xy in visible):raise ValueError('Invalid reviewed joint')

    def geometry(params):
        p=params.reshape(5,10);dirs=np.array([[[direction(a) for a in side] for side in row[:8].reshape(2,2,2)] for row in p]);xyz=np.zeros((5,2,3,3));xyz[:,:,0]=hips
        for j in range(2):xyz[:,:,j+1]=xyz[:,:,j]+dirs[:,:,j]*lengths[:,j][None,:,None]
        denom=xyz[:,:,:,2]+depth
        if np.min(denom)<=0:raise ValueError('Nonpositive diagnostic projection depth')
        projected=focal*(xyz[:,:,:,:2]+p[:,None,None,8:])/denom[:,:,:,None]+np.array([480,260])
        return dirs,xyz,projected

    def data_residual(projected):return np.concatenate([projected[i,sides.index(n.split('_')[0]),parts.index(n.split('_')[1])]-xy for i,n,xy in visible])
    def residual(params,weight):
        dirs,xyz,pred=geometry(params)
        return np.concatenate([data_residual(pred)/5,((dirs-prior)/.35).ravel(),
                               (weight*(dirs[2:]-2*dirs[1:-1]+dirs[:-2])/.15).ravel()])
    def metrics(params):
        dirs,xyz,pred=geometry(params);dr=data_residual(pred).reshape(-1,2)
        angular=np.degrees(np.arccos(np.clip(np.sum(dirs*prior,axis=-1),-1,1)))
        change=np.degrees(np.arccos(np.clip(np.sum(dirs[2]*dirs[1],axis=-1),-1,1)))
        closure=max(abs(np.linalg.norm(xyz[i,s,j+1]-xyz[i,s,j])-lengths[s,j]) for i in range(5) for s in range(2) for j in range(2))
        assert closure<1e-10
        return {'visible_joint_rmse_px':float(np.sqrt(np.mean(np.sum(dr*dr,axis=1)))),
                'max_direction_departure_from_prior_deg':float(angular.max()),
                'direction_second_difference_rms':float(np.sqrt(np.mean((dirs[2:]-2*dirs[1:-1]+dirs[:-2])**2))),
                'right_shin_change_21_to_22_deg':float(change[1,1]),'bone_length_max_error_units':float(closure)},xyz,pred,dirs
    lower=np.full((5,10),-np.inf);upper=np.full((5,10),np.inf)
    lower[:,[1,3,5,7]]=-math.pi/2+1e-7;upper[:,[1,3,5,7]]=math.pi/2-1e-7
    candidates=[]
    for weight in weights:
        result=least_squares(lambda p:residual(p,weight),initial.ravel(),bounds=(lower.ravel(),upper.ravel()),max_nfev=400,ftol=1e-8,xtol=1e-8,gtol=1e-8)
        metrics_out,xyz,pred,dirs=metrics(result.x)
        candidates.append({'temporal_weight':weight,'optimizer_success':bool(result.success),'optimizer_message':result.message,'nfev':result.nfev,
                           'metrics':metrics_out,'frames':[{'source_frame':f['source_frame'],'pts_s':f['pts_s'],'contact_review':f['contact'],
                            'translation':result.x.reshape(5,10)[i,8:].tolist()+[depth],
                            'xyz_right_down_forward':{s+'_'+part:xyz[i,si,pi].tolist() for si,s in enumerate(sides) for pi,part in enumerate(parts)},
                            'projected':{s+'_'+part:pred[i,si,pi].tolist() for si,s in enumerate(sides) for pi,part in enumerate(parts)},
                            'leg_unit_directions':dirs[i].tolist()} for i,f in enumerate(frames)]})
    return {'schema':'addams-local-leg-candidates.v1','status':'REVIEW','focal_px':focal,'shared_depth_candidate':depth,
            'initial_fixed_depth_metrics':metrics(initial.ravel())[0],'visible_joint_count':len(visible),'candidates':candidates,
            'limits':['Focal/depth are pinned diagnostic candidates, not recovered camera.',
                      'Residual uses fitted human points, not independent validation.',
                      'Contact labels preserved but not yet used as physical constraints.',
                      'Leg directions/endpoints only; no exported rig quaternion animation or mesh acceptance.',
                      'Soft direction prior/second differences are not anatomical joint limits or proof of motion correctness.',
                      'Local optimizer only, no automatic candidate selection or production replacement.']}


def main():
    p=argparse.ArgumentParser();p.add_argument('--review',type=Path,required=True);p.add_argument('--baseline-dir',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    paths=[a.review]+[a.baseline_dir/n for n in ['distributed-control.json','distributed-score.json','fixed-rig-report.json']]
    report=solve(*[json.loads(x.read_text()) for x in paths]);report['inputs']=[{'name':x.name,'sha256':hashlib.sha256(x.read_bytes()).hexdigest()} for x in paths]
    report['solver_script_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if a.out.exists():raise ValueError('Use a new output path; candidate versions are immutable')
    a.out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps([{'weight':r['temporal_weight'],**r['metrics']} for r in report['candidates']],indent=2))

if __name__=='__main__':main()
