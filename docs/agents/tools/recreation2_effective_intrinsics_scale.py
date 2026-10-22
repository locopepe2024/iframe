"""Conditional camera sensitivity and scale gauge; no production retarget changes."""
import json
import math
from pathlib import Path
import numpy as np
import recreation2_world_perspective_fit as base

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/agents/raw/2026-10-22-effective-intrinsics-scale'
FIT_NAMES = {'left_shoulder','right_shoulder','left_hip','right_hip',
             'left_elbow','right_elbow','left_knee','right_knee'}
EVENTS = (1,17,23,29,41,55)

def subset(frame, names):
    ids = [i for i,n in enumerate(frame['names']) if n in names]
    return {**frame, 'names':[frame['names'][i] for i in ids],
            **{k:frame[k][ids] for k in ('world','image','weights')}}

def score(frame, rotation, focal, principal, params):
    values = base.perspective_residuals(frame, rotation, focal, params, principal)
    if values is None:
        raise ValueError('nonpositive held-out point depth')
    return {**frame,'residuals':values[0]}

def main():
    track_path = ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json'
    pts_path = track_path.with_name('pts-map.json')
    camera_path = ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json'
    track = json.loads(track_path.read_text())
    camera = json.loads(camera_path.read_text())
    width,height = camera['image_size_px']
    frames = base.parse_data(track,track,json.loads(pts_path.read_text()),width,height)
    rotation = np.array(camera['camera_rotation_world_to_camera_columns'])
    train = [f for f in frames if f['frame']<=53]
    chain_lengths=[]
    for f in train:
        xyz={n:p for n,p in zip(f['names'],f['world'])}
        chain_lengths.append(np.mean([sum(np.linalg.norm(xyz[a]-xyz[b]) for a,b in
            [(s+'_hip',s+'_knee'),(s+'_knee',s+'_ankle')]) for s in ('left','right')]))
    reference=float(np.median(chain_lengths))
    all_names=set(base.JOINTS)
    assert FIT_NAMES.isdisjoint(all_names-FIT_NAMES)
    fit_frames=[subset(f,FIT_NAMES) for f in frames]
    held_frames=[subset(f,all_names-FIT_NAMES) for f in frames]
    assert all(len(f['names'])>=6 and len(h['names'])>=6 for f,h in zip(fit_frames,held_frames))
    records=[]
    def evaluate(focal,principal):
        fits=base.fit_all(fit_frames,rotation,focal,principal)
        held=[score(h,rotation,focal,principal,r['params']) for h,r in zip(held_frames,fits)]
        result={'focal_px':float(focal),'principal_point_px':list(principal),
                'horizontal_fov_deg_if_centered':float(math.degrees(2*math.atan(width/(2*focal))))}
        for label,predicate in [('train',lambda f:f['frame']<=53),('later',lambda f:f['frame']>=63),('all',lambda f:True)]:
            result[label+'_fit']=base.aggregate([r for r in fits if predicate(r)])
            result[label+'_heldout']=base.aggregate([r for r in held if predicate(r)])
        result['train_median_depth_reference_units']=float(np.median([r['hip_camera_depth_model_units']/reference for r in fits if r['frame']<=53]))
        result['events']={str(r['frame']):{'fit_rmse_px':r['metrics']['weighted_rmse_px'],
            'heldout':base.metrics(h['residuals'],h['weights'],h['names']),
            'root_xyz_reference_units':(np.array(r['root_camera_xyz_model_units'])/reference).tolist()}
            for r,h in zip(fits,held) if r['frame'] in EVENTS}
        return result
    for dx in (-.05,0,.05):
        for dy in (-.05,0,.05):
            principal=[width*(.5+dx),height*(.5+dy)]
            for focal in np.geomspace(600,4000,21):
                records.append(evaluate(float(focal),principal))
    best=min(records,key=lambda r:r['train_fit']['weighted_rmse_px'])
    per_principal=[]
    for principal in sorted({tuple(r['principal_point_px']) for r in records}):
        rows=[r for r in records if tuple(r['principal_point_px'])==principal]
        pick=min(rows,key=lambda r:r['train_fit']['weighted_rmse_px'])
        per_principal.append(pick)
    near=[r for r in records if r['train_fit']['weighted_rmse_px']<=best['train_fit']['weighted_rmse_px']*1.01]
    old_focal=camera['selected_focal_px'];center=camera['principal_point_px']
    baseline=evaluate(old_focal,center)
    regression=base.aggregate(base.fit_all(frames,rotation,old_focal,center))
    regression_delta=abs(regression['weighted_rmse_px']-camera['comparison']['perspective_all']['weighted_rmse_px'])
    assert regression_delta<1e-9
    gauge=[]
    for f in frames:
        fit=base.fit_translation(f,rotation,old_focal,center)
        for scale in (.5,1/reference,2):
            scaled={**f,'world':f['world']*scale}
            params=fit['params'].copy();params[:2]*=scale;params[2]+=math.log(scale)
            residual=base.perspective_residuals(scaled,rotation,old_focal,params,center)[0]
            delta=float(np.max(np.abs(residual-fit['residuals'])))
            assert delta<1e-6
            gauge.append(delta)
    report={'schema':'recreation2-effective-intrinsics-scale.v1',
        'input_sha256':{str(p.relative_to(ROOT)):base.digest(p) for p in (track_path,pts_path,camera_path)},
        'tool_sha256':base.digest(__file__),'dependency_tool_sha256':base.digest(base.__file__),
        'image_size_px':[width,height],'frame_count':len(frames),
        'fit_joints':sorted(FIT_NAMES),'heldout_joints':sorted(all_names-FIT_NAMES),
        'reference_length':{'definition':'training median of mean left/right hip-knee-ankle chain lengths',
            'value_model_units':reference,'train_min_model_units':float(min(chain_lengths)),
            'train_max_model_units':float(max(chain_lengths)),
            'scale_to_reference_units':1/reference,'is_measured_physical_length':False,
            'normalization':'one global factor; no per-frame bone length correction'},
        'rotation':rotation.tolist(),'rotation_refitted':False,
        'candidate_count':len(records),'selection':'current grid uses train fit joints RMSE only; current translation/K exclude held-out joints, but inherited frozen rotation was fitted using all 16 joints',
        'best':best,'best_focal_is_search_boundary':bool(np.isclose(best['focal_px'],600) or np.isclose(best['focal_px'],4000)),'baseline_fixed_1449_center':baseline,'best_by_principal':per_principal,
        'near_best_1pct':{'count':len(near),'focal_range_px':[min(r['focal_px'] for r in near),max(r['focal_px'] for r in near)],
            'depth_range_reference_units':[min(r['train_median_depth_reference_units'] for r in near),max(r['train_median_depth_reference_units'] for r in near)]},
        'verification':{'old_all_joint_fit_rmse_delta_px':regression_delta,'scale_gauge_max_pixel_delta':max(gauge),
            'scale_gauge_check_count':len(gauge),'event_frames_present':list(EVENTS)},
        'limits':['conditional on same-model pose and frozen prior rotation, square pixels and zero distortion',
            'held-out joints share the same pose estimator and informed the inherited frozen rotation; current-step diagnostic only, not strict held-out validation or independent ground truth',
            'per-frame translation fitted from current frame; no trajectory prediction',
            'focal/principal grid is a sensitivity experiment, not independent camera calibration or confidence interval',
            'reference length fixes units only; no measured body scale, contact or target rig validation'],
        'candidates':records}
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('reference_length','best','baseline_fixed_1449_center','near_best_1pct','verification')},indent=2))

if __name__=='__main__':main()
