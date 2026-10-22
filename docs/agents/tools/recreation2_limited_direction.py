"""Limited source-world direction counterfactual; never production retargeting."""
import json
import math
from pathlib import Path
import cv2
import numpy as np
import scipy
from scipy.optimize import least_squares
import recreation2_world_perspective_fit as base
import recreation2_world_bone_length_audit as bones
from recreation2_effective_intrinsics_scale import ROOT, FIT_NAMES, EVENTS, subset, score

OUT = ROOT / 'docs/agents/raw/2026-10-22-limited-direction'
ACTIVE = [(s + '_' + a, s + '_' + b) for s in ('left', 'right')
          for a, b in [('shoulder', 'elbow'), ('hip', 'knee')]]
PRIOR_PX_PER_DEGREE = 1.


def directions(xyz):
    pts = bones.nodes(xyz)
    result = {}
    for a, b in bones.TREE:
        d = pts[b] - pts[a]
        d = d / np.linalg.norm(d)
        helper = np.eye(3)[np.argmin(np.abs(d))]
        u = np.cross(d, helper)
        u /= np.linalg.norm(u)
        result[(a, b)] = (d, u, np.cross(d, u))
    return result


def reconstruct(basis, refs, angles):
    points = {'pelvis': np.zeros(3)}
    adjustments = dict(zip(ACTIVE, np.asarray(angles).reshape(-1, 2)))
    for a, b in bones.TREE:
        d, u, v = basis[(a, b)]
        xy = adjustments.get((a, b), np.zeros(2))
        theta = np.linalg.norm(xy)
        # np.sinc uses pi-normalized argument; analytic limit at zero.
        direction = np.cos(theta)*d + np.sinc(theta/np.pi)*(xy[0]*u+xy[1]*v)
        points[b] = points[a] + refs[a+'->'+b]*direction
    return {n: points[n] for n in base.JOINTS}


def geometry_frame(frame, geometry):
    return {**frame, 'world': np.array([geometry[n] for n in frame['names']])}


def solve(frame, xyz, refs, rotation, focal, principal, cap):
    basis = directions(xyz)
    geometry = reconstruct(basis, refs, np.zeros(8))
    fixed_frame = geometry_frame(frame, geometry)
    initial = base.fit_translation(subset(fixed_frame, FIT_NAMES), rotation, focal, principal)
    if initial is None:
        raise ValueError('initial root has nonpositive depth')
    rad = math.radians(cap)
    bound = rad/math.sqrt(2)
    fit_frame = subset(frame, FIT_NAMES)
    def residual(params):
        geom = reconstruct(basis, refs, params[3:])
        fitted = geometry_frame(fit_frame, geom)
        values = base.perspective_residuals(fitted, rotation, focal, params[:3], principal)
        if values is None:
            return np.full(2*len(fit_frame['names'])+8, 1e8)
        return np.r_[(values[0]*np.sqrt(fit_frame['weights'][:, None])).ravel(),
                     np.degrees(params[3:])*PRIOR_PX_PER_DEGREE]
    start = np.r_[initial['params'], np.zeros(8)]
    result = least_squares(residual, start,
                           bounds=(np.r_[[-np.inf]*3, [-bound]*8],
                                   np.r_[[np.inf]*3, [bound]*8]),
                           max_nfev=120, ftol=1e-8, xtol=1e-8, gtol=1e-8)
    geom = reconstruct(basis, refs, result.x[3:])
    angles = np.degrees(np.linalg.norm(result.x[3:].reshape(-1, 2), axis=1))
    assert max(angles) <= cap+1e-8
    length_error = max(abs(np.linalg.norm(bones.nodes(geom)[b]-bones.nodes(geom)[a])-refs[a+'->'+b])
                       for a, b in bones.TREE)
    assert length_error < 1e-12
    row = {'angles_deg': dict(zip([a+'->'+b for a, b in ACTIVE], angles.tolist())),
           'length_max_error': float(length_error), 'optimizer_success': bool(result.success),
           'optimizer_status': int(result.status), 'nfev': int(result.nfev),
           'root_params': result.x[:3].tolist(), 'root_fixed_baseline_params': initial['params'].tolist()}
    return geometry_frame(frame, geom), result.x[:3], row


def synthetic():
    rng = np.random.default_rng(20261022)
    xyz = {n: rng.uniform(-.4, .4, 3) for n in base.JOINTS}
    pts = bones.nodes(xyz)
    refs = {a+'->'+b: float(np.linalg.norm(pts[b]-pts[a])) for a, b in bones.TREE}
    basis = directions(xyz)
    def make(angles):
        geom = reconstruct(basis, refs, angles)
        world = np.array([geom[n] for n in base.JOINTS])
        camera = world + [.1, -.1, 5.]
        return {'world': world, 'image': camera[:, :2]/camera[:, 2:]*1600+[697,396],
                'weights': np.ones(16), 'names': list(base.JOINTS)}
    zero = make(np.zeros(8))
    _, _, unchanged = solve(zero, xyz, refs, np.eye(3), 1600, [697,396], 5)
    assert max(unchanged['angles_deg'].values()) < 1e-7
    known = make(np.radians([2,-2,1,2,-2,1,2,2]))
    fitted, params, row = solve(known, xyz, refs, np.eye(3),1600,[697,396],5)
    before = geometry_frame(known, reconstruct(basis, refs, np.zeros(8)))
    fit0 = base.fit_translation(subset(before,FIT_NAMES),np.eye(3),1600,[697,396])
    after = score(subset(fitted,FIT_NAMES),np.eye(3),1600,[697,396],params)
    rmse = base.metrics(after['residuals'],after['weights'],after['names'])['weighted_rmse_px']
    assert rmse < fit0['metrics']['weighted_rmse_px']*.7
    altered = {**known,'image': known['image'].copy()}
    for i,n in enumerate(known['names']):
        if n not in FIT_NAMES:
            altered['image'][i] += [150,-75]
    _, params2, row2 = solve(altered,xyz,refs,np.eye(3),1600,[697,396],5)
    invariance = float(np.max(np.abs(params-params2)))
    assert invariance < 1e-12 and row['angles_deg']==row2['angles_deg']
    return {'zero_perturbation_max_angle_deg':max(unchanged['angles_deg'].values()),
            'known_small_direction_perturbation_fit_rmse_before_px':fit0['metrics']['weighted_rmse_px'],
            'known_small_direction_perturbation_fit_rmse_after_px':rmse,
            'score_point_perturbation_fit_root_max_delta':invariance}


def main():
    paths = {'track': ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json',
             'pts': ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json',
             'rotation': ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json',
             'prior': ROOT/'docs/agents/raw/2026-10-22-humanfov-bone-length/bone-length-report.json'}
    inp = {k:json.loads(p.read_text()) for k,p in paths.items()}
    prior = inp['prior']; K = np.array(prior['fixed_camera_K'])
    rotation = np.array(inp['rotation']['camera_rotation_world_to_camera_columns']) @ np.diag([1,K[1,1]/K[0,0],1])
    focal = K[0,0]; principal = K[:2,2]; refs=prior['tree_reference_lengths_model_units']
    frames = base.parse_data(inp['track'],inp['track'],inp['pts'],1394,792)
    raw = {r['frame']:r for r in inp['track']['frames']}
    variants = {n:[] for n in ['original','fixed_lengths','direction_5deg','direction_10deg']}
    groups = {'fit':FIT_NAMES, 'score':set(base.JOINTS)-FIT_NAMES,
              'wrists':{'left_wrist','right_wrist'}, 'ankles':{'left_ankle','right_ankle'},
              'shoe_landmarks':{s+'_'+j for s in ('left','right') for j in ('heel','foot_index')}}
    projections={}
    verification=synthetic()
    for frame in frames:
        xyz={n:np.array(raw[frame['frame']]['target_world_landmarks'][idx][:3]) for n,idx in base.JOINTS.items()}
        for name in variants:
            meta={}
            if name.startswith('direction_'):
                adjusted, params, meta=solve(frame,xyz,refs,rotation,focal,principal,
                                             5 if name=='direction_5deg' else 10)
            else:
                geom=xyz if name=='original' else bones.fixed_geometry(xyz,refs)
                adjusted=geometry_frame(frame,geom)
                fit=base.fit_translation(subset(adjusted,FIT_NAMES),rotation,focal,principal)
                params=fit['params']
            row={**frame, 'diagnostic':meta, 'groups':{}}
            for label,names in groups.items():
                part=subset(adjusted,names)
                if not len(part['names']):continue
                scored=score(part,rotation,focal,principal,params)
                row['groups'][label]=scored
            variants[name].append(row)
            if frame['frame'] in EVENTS:
                values=base.perspective_residuals(adjusted,rotation,focal,params,principal)
                projections[(name,frame['frame'])]=dict(zip(frame['names'],(values[0]+frame['image']).tolist()))
    summary={}
    for name,rows in variants.items():
        item={}
        for window,accept in [('early',lambda r:r['frame']<=53),('later',lambda r:r['frame']>=63),('all',lambda r:True)]:
            item[window]={label:base.aggregate([r['groups'][label] for r in rows if accept(r) and label in r['groups']]) for label in groups}
        item['events']={str(r['frame']):{label:base.metrics(v['residuals'],v['weights'],v['names']) for label,v in r['groups'].items()}
                        for r in rows if r['frame'] in EVENTS}
        item['frames']=[{'frame':r['frame'],'source_pts_s':r['source_pts_s'],'diagnostic':r['diagnostic'],
                         'groups':{label:base.metrics(v['residuals'],v['weights'],v['names']) for label,v in r['groups'].items()}} for r in rows]
        if name.startswith('direction_'):
            deltas=[]
            for row,baseline in zip(item['frames'],summary['fixed_lengths']['frames']):
                deltas.append({'frame':row['frame'],'score_rmse_delta_px':row['groups']['score']['weighted_rmse_px']-baseline['groups']['score']['weighted_rmse_px']})
            item['score_delta_vs_fixed']={'improved_count':sum(r['score_rmse_delta_px']<0 for r in deltas),
                'worsened_count':sum(r['score_rmse_delta_px']>0 for r in deltas),
                'worst_five':sorted(deltas,key=lambda r:r['score_rmse_delta_px'],reverse=True)[:5]}
        summary[name]=item
    for name,oldname in [('original','original'),('fixed_lengths','fixed_segment_lengths')]:
        for window,oldwindow in [('early','train'),('later','later')]:
            delta=abs(summary[name][window]['score']['weighted_rmse_px']-prior['comparison'][oldname][oldwindow+'_heldout']['weighted_rmse_px'])
            assert delta<1e-9
            verification[name+'_'+window+'_regression_delta_px']=delta
    OUT.mkdir(parents=True,exist_ok=True)
    # Full-frame six-event panel: annotations are projections, not an estimated target rig.
    colors={'original':(130,130,130),'fixed_lengths':(255,190,30),'direction_5deg':(40,220,60),'direction_10deg':(200,60,220)}
    for event in EVENTS:
        source=ROOT/f'docs/agents/raw/2026-10-22-geocalib-effective-camera/frames/event-{EVENTS.index(event)+1:02d}.png'
        img=cv2.imread(str(source))
        if img is None:raise ValueError('missing source event image '+str(source))
        frame=next(f for f in frames if f['frame']==event)
        panels=[]
        for name in variants:
            panel=img.copy(); pts=projections[(name,event)]
            for a,b in bones.TREE:
                if a in pts and b in pts:
                    cv2.line(panel,tuple(np.rint(pts[a]).astype(int)),tuple(np.rint(pts[b]).astype(int)),colors[name],2)
            for p in pts.values():cv2.circle(panel,tuple(np.rint(p).astype(int)),4,colors[name],-1)
            for p in frame['image']:cv2.circle(panel,tuple(np.rint(p).astype(int)),6,(255,255,255),1)
            cv2.rectangle(panel,(0,0),(1394,38),(0,0,0),-1)
            error=summary[name]['events'][str(event)]['score']['weighted_rmse_px']
            cv2.putText(panel,f'{name} | source {event} | distal RMSE {error:.2f}px',(18,27),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),1)
            panels.append(cv2.resize(panel,(697,396)))
        cv2.imwrite(str(OUT/f'event-{event:03d}.jpg'),np.vstack([np.hstack(panels[:2]),np.hstack(panels[2:])]))
    report={'schema':'recreation2-limited-direction.v1','input_sha256':{str(p.relative_to(ROOT)):base.digest(p) for p in paths.values()},
            'tool_sha256':base.digest(__file__), 'dependency_sha256':{Path(m.__file__).name:base.digest(m.__file__) for m in [base,bones]},
            'versions':{'numpy':np.__version__,'scipy':scipy.__version__,'opencv':cv2.__version__},
            'K':K.tolist(),'fixed_projection_basis':rotation.tolist(),
            'active_edges':[a+'->'+b for a,b in ACTIVE], 'prior_px_per_degree':PRIOR_PX_PER_DEGREE,
            'fit_names':sorted(FIT_NAMES),'score_names':sorted(groups['score']),
            'frame_count':len(frames),'comparison':summary,'verification':verification,
            'limits':['same estimator 2D/world; inherited full-joint rotation and training bone references: not strict independent holdout',
                      'per-frame diagnostic only, no temporal or anatomical joint-angle constraints, no contact or metric depth validation',
                      'world upper-arm/thigh direction moves descendants but preserves other world edge directions; not a full anatomical joint rotation',
                      'zero distortion, shared centered K; camera uncertainties remain',
                      'no main-chain, target rig or H3 change']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'comparison':{n:{w:{g:round(v['weighted_rmse_px'],5) for g,v in d[w].items()} for w in ['early','later']} for n,d in summary.items()},'verification':verification},indent=2))

if __name__=='__main__':main()
