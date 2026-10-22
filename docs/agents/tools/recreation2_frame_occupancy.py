"""Separate global projected scale from local residuals; no camera calibration."""
import json
import numpy as np
import recreation2_world_perspective_fit as base
import recreation2_world_bone_length_audit as bones
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES,EVENTS,subset,score

OUT=ROOT/'docs/agents/raw/2026-10-22-frame-occupancy'
WIDTH,HEIGHT=1394,792


def fit_2d(predicted,observed,weights,allow_scale):
    weights=np.asarray(weights)
    xp=np.average(predicted,axis=0,weights=weights)
    yp=np.average(observed,axis=0,weights=weights)
    x,y=predicted-xp,observed-yp
    denominator=np.sum(weights[:,None]*x*x)
    if denominator<=1e-12:raise ValueError('degenerate projected geometry')
    scale=float(np.sum(weights[:,None]*x*y)/denominator) if allow_scale else 1.
    if scale<=0:raise ValueError('nonpositive isotropic scale')
    return scale,yp-scale*xp


def bounds(points):
    low,high=np.min(points,axis=0),np.max(points,axis=0)
    return {'x_min':float(low[0]),'y_min':float(low[1]),'x_max':float(high[0]),'y_max':float(high[1]),
            'width_px':float(high[0]-low[0]),'height_px':float(high[1]-low[1]),
            'width_fraction':float((high[0]-low[0])/WIDTH),'height_fraction':float((high[1]-low[1])/HEIGHT)}


def describe(values):
    x=np.asarray(values)
    return {'count':len(x),'min':float(x.min()),'p05':float(np.percentile(x,5)),
            'median':float(np.median(x)),'p95':float(np.percentile(x,95)),'max':float(x.max())}


def verify():
    rng=np.random.default_rng(22);p=rng.normal(size=(16,2))*40;w=np.ones(16)
    truth=1.2*p+[20,-35]
    s,t=fit_2d(p[:8],truth[:8],w[:8],True)
    error=float(np.abs(s*p+t-truth).max());assert error<1e-12
    distorted=truth.copy();distorted[0]+=[50,20]
    sd,td=fit_2d(p,distorted,w,True)
    remaining=float(np.sqrt(np.mean(np.sum((sd*p+td-distorted)**2,axis=1))))
    assert remaining>1
    truth[8:]+=200
    s2,t2=fit_2d(p[:8],truth[:8],w[:8],True)
    assert s==s2 and np.array_equal(t,t2)
    return {'known_scale_recovered':s,'known_transform_max_error_px':error,
            'local_distortion_remaining_rmse_px':remaining,'score_observation_perturbation_scale_delta':abs(s-s2)}


def main():
    paths={'track':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json',
           'pts':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json',
           'rotation':ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json',
           'prior':ROOT/'docs/agents/raw/2026-10-22-humanfov-bone-length/bone-length-report.json'}
    inp={n:json.loads(p.read_text()) for n,p in paths.items()}
    prior=inp['prior'];K=np.array(prior['fixed_camera_K'])
    rot=np.array(inp['rotation']['camera_rotation_world_to_camera_columns'])@np.diag([1,K[1,1]/K[0,0],1])
    focal=K[0,0];principal=K[:2,2]
    frames=base.parse_data(inp['track'],inp['track'],inp['pts'],WIDTH,HEIGHT)
    raw={r['frame']:r for r in inp['track']['frames']}
    refs=prior['tree_reference_lengths_model_units']
    rows=[];aggregate={}
    for frame in frames:
        source=raw[frame['frame']];land=np.array(source['target_landmarks'])
        box=source.get('target_bbox');det=None
        if box is not None:
            det={'width_fraction':float(box[2]-box[0]),'height_fraction':float(box[3]-box[1]),
                 'bbox_normalized_xyxy':box}
        face=[i for i in range(11) if land[i,3]>=.8 and (land[i,:2]>=0).all() and (land[i,:2]<=1).all()]
        feet=[i for i in range(27,33) if land[i,3]>=.8 and (land[i,:2]>=0).all() and (land[i,:2]<=1).all()]
        span=float(max(land[feet,1])-min(land[face,1])) if face and feet else None
        foot_bilateral=all(any(i in feet for i in side) for side in [[27,29,31],[28,30,32]])
        row={'frame':frame['frame'],'source_pts_s':frame['source_pts_s'],'detection_box':det,
             'face_to_shoe_vertical_fraction':span,'high_visibility_face_indices':face,'high_visibility_foot_indices':feet,
             'bilateral_high_visibility_shoe_points':foot_bilateral,
             'visible_body_joint_count':len(frame['names']),'observed_body_bounds':bounds(frame['image']),
             'observed_body_names':frame['names'],'variants':{}}
        xyz={n:np.array(source['target_world_landmarks'][idx][:3]) for n,idx in base.JOINTS.items()}
        for name in ['original','fixed_lengths']:
            geom=xyz if name=='original' else bones.fixed_geometry(xyz,refs)
            f={**frame,'world':np.array([geom[n] for n in frame['names']])}
            fitted=base.fit_translation(subset(f,FIT_NAMES),rot,focal,principal)
            values=base.perspective_residuals(f,rot,focal,fitted['params'],principal)
            pred=frame['image']+values[0]
            fitids=[i for i,n in enumerate(frame['names']) if n in FIT_NAMES]
            scoreids=[i for i,n in enumerate(frame['names']) if n not in FIT_NAMES]
            joints=dict(zip(frame['names'],pred));obs=dict(zip(frame['names'],frame['image']))
            def torso(points):
                if not all(n in points for n in ['left_hip','right_hip','left_shoulder','right_shoulder']):return None
                return float(np.linalg.norm((points['left_shoulder']+points['right_shoulder']-points['left_hip']-points['right_hip'])/2))
            pred_bound=bounds(pred);obs_bound=row['observed_body_bounds']
            result={'projected_body_bounds':pred_bound,
                    'projected_over_observed_height':pred_bound['height_px']/obs_bound['height_px'],
                    'projected_over_observed_width':pred_bound['width_px']/obs_bound['width_px'],
                    'projected_torso_length_px':torso(joints),'observed_torso_length_px':torso(obs),
                    'root_camera_xyz_model_units':fitted['root_camera_xyz_model_units'],'corrections':{}}
            for correction in ['baseline','translation_only','isotropic_scale_translation']:
                if correction=='baseline':s,t=1.,np.zeros(2)
                else:s,t=fit_2d(pred[fitids],frame['image'][fitids],frame['weights'][fitids],correction=='isotropic_scale_translation')
                res=s*pred+t-frame['image']
                result['corrections'][correction]={'scale':s,'translation_px':t.tolist(),
                    'fit':base.metrics(res[fitids],frame['weights'][fitids],[frame['names'][i] for i in fitids]),
                    'score':base.metrics(res[scoreids],frame['weights'][scoreids],[frame['names'][i] for i in scoreids])}
                aggregate.setdefault((name,correction),[]).append({**frame,'names':[frame['names'][i] for i in scoreids],
                    'weights':frame['weights'][scoreids],'residuals':res[scoreids]})
            row['variants'][name]=result
        rows.append(row)
    summary={};verification=verify()
    for name,oldname in [('original','original'),('fixed_lengths','fixed_segment_lengths')]:
        summary[name]={}
        for window,accept in [('early',lambda r:r['frame']<=53),('later',lambda r:r['frame']>=63),('all',lambda r:True)]:
            selected=[r for r in rows if accept(r)]
            summary[name][window]={correction:base.aggregate([r for r in aggregate[(name,correction)] if accept(r)])
                                  for correction in ['baseline','translation_only','isotropic_scale_translation']}
            summary[name][window]['height_ratio']=describe([r['variants'][name]['projected_over_observed_height'] for r in selected])
            summary[name][window]['width_ratio']=describe([r['variants'][name]['projected_over_observed_width'] for r in selected])
            summary[name][window]['fit_isotropic_scale']=describe([r['variants'][name]['corrections']['isotropic_scale_translation']['scale'] for r in selected])
            if window!='all':
                oldwindow='train' if window=='early' else 'later'
                delta=abs(summary[name][window]['baseline']['weighted_rmse_px']-prior['comparison'][oldname][oldwindow+'_heldout']['weighted_rmse_px'])
                assert delta<1e-9
                verification[name+'_'+window+'_baseline_delta_px']=delta
    OUT.mkdir(parents=True,exist_ok=True)
    report={'schema':'recreation2-frame-occupancy.v1','image_size_px':[WIDTH,HEIGHT],
            'input_sha256':{str(p.relative_to(ROOT)):base.digest(p) for p in paths.values()},
            'tool_sha256':base.digest(__file__),
            'dependency_sha256':{m.__name__:base.digest(m.__file__) for m in [base,bones]},
            'K':K.tolist(),'frame_count':len(rows),'summary':summary,'frames':rows,
            'source_occupancy':{'detection_box_height':describe([r['detection_box']['height_fraction'] for r in rows if r['detection_box']]),
                'face_to_shoe_height':describe([r['face_to_shoe_vertical_fraction'] for r in rows if r['face_to_shoe_vertical_fraction'] is not None]),
                'bilateral_high_visibility_shoe_frame_count':sum(r['bilateral_high_visibility_shoe_points'] for r in rows)},
            'verification':verification,
            'limits':['2D landmarks/bbox are model observations, not silhouette or manual ground truth',
                      'face-to-shoe span excludes head top and varies with pose; not physical height or full-body detection',
                      'per-frame common-visible body bounds change joint membership; compare same-frame prediction/observation only',
                      '2D scale correction is a counterfactual with current-frame root refit; not physical depth/focal recovery',
                      'inherited rotation and reference lengths use historical score joints; not strict independent validation',
                      'source human layer only; no target rig occupancy/contact/H3 validation']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(3,1,figsize=(12,10),sharex=True)
    ts=[r['source_pts_s'] for r in rows]
    axes[0].plot(ts,[r['detection_box']['height_fraction'] if r['detection_box'] else np.nan for r in rows],label='Detector box height / frame height')
    axes[0].plot(ts,[r['face_to_shoe_vertical_fraction'] if r['face_to_shoe_vertical_fraction'] is not None else np.nan for r in rows],label='Visible face-to-shoe span / frame height')
    for name in summary:
        axes[1].plot(ts,[r['variants'][name]['projected_over_observed_height'] for r in rows],label=name+' height ratio')
        for correction,style in [('baseline','-'),('isotropic_scale_translation','--')]:
            axes[2].plot(ts,[r['variants'][name]['corrections'][correction]['score']['weighted_rmse_px'] for r in rows],style,label=name+' '+correction)
    axes[1].axhline(1,color='gray',linewidth=1)
    for ax in axes:
        ax.legend(fontsize=8);ax.grid(alpha=.25)
    axes[0].set_ylabel('Frame fraction');axes[1].set_ylabel('Projected / observed');axes[2].set_ylabel('Distal RMSE (px)');axes[2].set_xlabel('Source PTS (s)')
    fig.suptitle('Source human layer: occupancy vs global 2D scale counterfactual\nPaired estimator observations; no metric camera or target rig validation')
    fig.tight_layout();fig.savefig(OUT/'occupancy-scale.png',dpi=150);plt.close(fig)
    print(json.dumps({'summary':summary,'source_occupancy':report['source_occupancy'],'verification':verification},indent=2))

if __name__=='__main__':main()
