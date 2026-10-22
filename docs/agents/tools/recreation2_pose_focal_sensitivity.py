"""Conditional source pose/focal study, not a focal estimator."""
import json
from pathlib import Path
import numpy as np
import recreation2_world_perspective_fit as base
import recreation2_world_bone_length_audit as bones
import recreation2_limited_direction as limited
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES,EVENTS,subset,score

OUT=ROOT/'docs/agents/raw/2026-10-22-pose-focal-sensitivity'
FACTORS=(.8,1.,1.2)


def main():
    paths={'track':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json',
           'pts':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json',
           'rotation':ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json',
           'prior':ROOT/'docs/agents/raw/2026-10-22-humanfov-bone-length/bone-length-report.json',
           'direction_prior':ROOT/'docs/agents/raw/2026-10-22-limited-direction/report.json'}
    inp={n:json.loads(p.read_text()) for n,p in paths.items()}
    prior=inp['prior'];K=np.array(prior['fixed_camera_K']);focal=K[0,0];principal=K[:2,2]
    basis=np.array(inp['rotation']['camera_rotation_world_to_camera_columns'])@np.diag([1,K[1,1]/K[0,0],1])
    frames=base.parse_data(inp['track'],inp['track'],inp['pts'],1394,792)
    raw={r['frame']:r for r in inp['track']['frames']};refs=prior['tree_reference_lengths_model_units']
    cases={};all_scores={};verification={}
    for factor in FACTORS:
        cases[str(factor)]={};all_scores[factor]={}
        for variant in ['original','fixed_lengths','direction_5deg']:
            rows=[];scored=[];fixed_root_scored=[]
            for frame in frames:
                xyz={n:np.array(raw[frame['frame']]['target_world_landmarks'][idx][:3]) for n,idx in base.JOINTS.items()}
                diag={}
                if variant=='direction_5deg':
                    adjusted,params,diag=limited.solve(frame,xyz,refs,basis,focal*factor,principal,5)
                else:
                    geom=xyz if variant=='original' else bones.fixed_geometry(xyz,refs)
                    adjusted=limited.geometry_frame(frame,geom)
                    fit=base.fit_translation(subset(adjusted,FIT_NAMES),basis,focal*factor,principal)
                    if fit is None:raise ValueError('nonpositive initial camera depth')
                    params=fit['params']
                fitpart=score(subset(adjusted,FIT_NAMES),basis,focal*factor,principal,params)
                held=score(subset(adjusted,set(base.JOINTS)-FIT_NAMES),basis,focal*factor,principal,params)
                # Validate positivity for ALL joints used, not just the fit subset.
                assert base.perspective_residuals(adjusted,basis,focal*factor,params,principal) is not None
                scored.append(held)
                row={'frame':frame['frame'],'source_pts_s':frame['source_pts_s'],
                     'root_camera_xyz_model_units':[float(params[0]),float(params[1]),float(np.exp(params[2]))],
                     'fit':base.metrics(fitpart['residuals'],fitpart['weights'],fitpart['names']),
                     'score':base.metrics(held['residuals'],held['weights'],held['names']), 'diagnostic':diag}
                if variant=='original':
                    center=base.fit_translation(subset(adjusted,FIT_NAMES),basis,focal,principal)
                    unchanged=score(subset(adjusted,set(base.JOINTS)-FIT_NAMES),basis,focal*factor,principal,center['params'])
                    fixed_root_scored.append(unchanged)
                    row['score_without_root_refit']=base.metrics(unchanged['residuals'],unchanged['weights'],unchanged['names'])
                rows.append(row)
            item={'frames':rows,'events':{str(r['frame']):r for r in rows if r['frame'] in EVENTS},'summary':{}}
            for window,accept in [('early',lambda r:r['frame']<=53),('later',lambda r:r['frame']>=63),('all',lambda r:True)]:
                item['summary'][window]=base.aggregate([r for r in scored if accept(r)])
                item['summary'][window]['median_root_depth_model_units']=float(np.median([r['root_camera_xyz_model_units'][2] for r in rows if accept(r)]))
                if variant=='original':item['summary'][window]['without_root_refit']=base.aggregate([r for r in fixed_root_scored if accept(r)])
                if factor==1 and window!='all':
                    old=inp['direction_prior']['comparison'][variant][window]['score']['weighted_rmse_px']
                    delta=abs(item['summary'][window]['weighted_rmse_px']-old)
                    assert delta<1e-9
                    verification[variant+'_'+window+'_baseline_delta_px']=delta
            cases[str(factor)][variant]=item;all_scores[factor][variant]=scored
            print('finished',factor,variant,flush=True)
    for factor in FACTORS:
        for variant,item in cases[str(factor)].items():
            central=cases['1.0'][variant]['frames']
            for row,center in zip(item['frames'],central,strict=True):
                assert row['frame']==center['frame']
                row['root_depth_ratio_to_center']=row['root_camera_xyz_model_units'][2]/center['root_camera_xyz_model_units'][2]
                row['score_rmse_delta_to_center_px']=row['score']['weighted_rmse_px']-center['score']['weighted_rmse_px']
            fixed=cases[str(factor)]['fixed_lengths']['frames']
            if variant=='direction_5deg':
                diffs=[r['score']['weighted_rmse_px']-f['score']['weighted_rmse_px'] for r,f in zip(item['frames'],fixed,strict=True)]
                item['improved_vs_fixed_frame_count']=sum(d<0 for d in diffs)
                item['worsened_vs_fixed_frame_count']=sum(d>0 for d in diffs)
                item['optimizer_success_count']=sum(r['diagnostic']['optimizer_success'] for r in item['frames'])
                item['max_angle_deg']=max(max(r['diagnostic']['angles_deg'].values()) for r in item['frames'])
                item['max_bone_length_error']=max(r['diagnostic']['length_max_error'] for r in item['frames'])
    report={'schema':'recreation2-pose-focal-sensitivity.v1','frame_count':len(frames),'central_K':K.tolist(),
            'focal_factors':FACTORS,'cases':cases,'verification':verification,
            'tool_sha256':base.digest(__file__),'dependency_sha256':{Path(m.__file__).name:base.digest(m.__file__) for m in [base,bones,limited]},
            'input_sha256':{str(p.relative_to(ROOT)):base.digest(p) for p in paths.values()},
            'limits':['conditional on same-model 2D/world, historical full-point camera rotation and training bone references; not independent validation',
                      'root and limited directions refit per frame; no temporal/contact/metric height validation',
                      'focal factors are sensitivity probes, not calibrated interval or confidence bounds',
                      'current anatomy, principal point, shared rotation and zero-distortion assumptions remain unverified',
                      'no main-chain, target rig or H3 modifications']}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({factor:{name:d['summary'] for name,d in case.items()} for factor,case in cases.items()},indent=2))

if __name__=='__main__':main()
