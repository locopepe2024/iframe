"""Audit model-space lengths and counterfactual fixed lengths, not physical truth."""
import json
from pathlib import Path
import numpy as np
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES,EVENTS,subset,score

OUT=ROOT/'docs/agents/raw/2026-10-22-humanfov-bone-length'
BODY_EDGES=[('hip_width','left_hip','right_hip'),('shoulder_width','left_shoulder','right_shoulder'),
            ('torso','pelvis','thorax')]
for side in ('left','right'):
    BODY_EDGES += [(side+'_upper_arm',side+'_shoulder',side+'_elbow'),
                   (side+'_forearm',side+'_elbow',side+'_wrist'),
                   (side+'_thigh',side+'_hip',side+'_knee'),
                   (side+'_shin',side+'_knee',side+'_ankle')]
EDGES=BODY_EDGES+[(s+'_'+label,s+'_ankle',s+'_'+joint)
                 for s in ('left','right') for label,joint in [('heel','heel'),('toe','foot_index')]]
TREE=[('pelvis','thorax'),('pelvis','left_hip'),('pelvis','right_hip'),
      ('thorax','left_shoulder'),('thorax','right_shoulder')]
for side in ('left','right'):
    TREE += [(side+'_shoulder',side+'_elbow'),(side+'_elbow',side+'_wrist'),
             (side+'_hip',side+'_knee'),(side+'_knee',side+'_ankle'),
             (side+'_ankle',side+'_heel'),(side+'_ankle',side+'_foot_index')]

def nodes(xyz):
    return {**xyz,'pelvis':(xyz['left_hip']+xyz['right_hip'])/2,
                  'thorax':(xyz['left_shoulder']+xyz['right_shoulder'])/2}

def lengths(xyz,edges=EDGES):
    points=nodes(xyz)
    return np.array([np.linalg.norm(points[a]-points[b]) for _,a,b in edges])

def describe(values):
    x=np.asarray(values,dtype=float)
    return {'count':len(x),'min':float(x.min()),'p05':float(np.percentile(x,5)),
            'median':float(np.median(x)),'p95':float(np.percentile(x,95)),
            'max':float(x.max()),'std_over_mean':float(np.std(x)/np.mean(x))}

def reference(length_matrix,train_indices):
    return np.median(length_matrix[train_indices],axis=0)

def scale_shape(length_matrix,refs):
    ratios=length_matrix/refs
    scales=np.median(ratios[:,:len(BODY_EDGES)],axis=1)
    return scales,ratios/scales[:,None]

def fixed_geometry(xyz,tree_refs):
    original=nodes(xyz);fixed={'pelvis':np.zeros(3)}
    for a,b in TREE:
        direction=original[b]-original[a];norm=np.linalg.norm(direction)
        if norm<=1e-9:raise ValueError('zero edge '+a+'->'+b)
        fixed[b]=fixed[a]+direction/norm*tree_refs[a+'->'+b]
    return {n:fixed[n] for n in xyz}

def verify_synthetic():
    rng=np.random.default_rng(22)
    xyz={n:rng.uniform(-1,1,3) for n in base.JOINTS}
    original=lengths(xyz)
    q,_=np.linalg.qr(rng.normal(size=(3,3)));q[:,0]*=np.linalg.det(q)
    rotated={n:p@q+np.array([2.,3.,4.]) for n,p in xyz.items()}
    err=float(np.max(np.abs(lengths(rotated)-original)));assert err<1e-12
    matrix=np.stack([original,original*2]);scales,shape=scale_shape(matrix,original)
    assert np.allclose(scales,[1,2]) and np.allclose(shape,1)
    altered={n:p.copy() for n,p in xyz.items()}
    altered['left_wrist']=xyz['left_elbow']+1.3*(xyz['left_wrist']-xyz['left_elbow'])
    ss,sh=scale_shape(np.stack([lengths(altered)]),original)
    index=[n for n,_,_ in EDGES].index('left_forearm')
    assert abs(ss[0]-1)<1e-12 and abs(sh[0,index]-1.3)<1e-12
    tree_refs={a+'->'+b:float(np.linalg.norm(nodes(xyz)[b]-nodes(xyz)[a])) for a,b in TREE}
    fixed=fixed_geometry(altered,tree_refs)
    fixed_error=float(np.max(np.abs(lengths(fixed)-original)));assert fixed_error<1e-12
    return {'rigid_transform_length_max_error':err,'uniform_scale_factors':scales.tolist(),
            'single_forearm_30pct_shape_ratio':float(sh[0,index]),'fixed_tree_length_max_error':fixed_error}

def main():
    paths={
      'track':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json',
      'pts':ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json',
      'rotation':ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json',
      'camera':ROOT/'docs/agents/raw/2026-10-22-geocalib-effective-camera/report.json',
      'prior_comparison':ROOT/'docs/agents/raw/2026-10-22-geocalib-effective-camera/pose-comparison.json'}
    inputs={k:json.loads(p.read_text()) for k,p in paths.items()}
    track=inputs['track'];raw_by_frame={r['frame']:r for r in track['frames']}
    frames=base.parse_data(track,track,inputs['pts'],1394,792)
    train_ids=[i for i,f in enumerate(frames) if f['frame']<=53]
    xyzs=[{n:np.array(raw_by_frame[f['frame']]['target_world_landmarks'][idx][:3],float)
           for n,idx in base.JOINTS.items()} for f in frames]
    image_nodes=[{n:np.array(raw_by_frame[f['frame']]['target_landmarks'][idx][:2],float)*[1394,792]
                  for n,idx in base.JOINTS.items()} for f in frames]
    matrix=np.stack([lengths(x) for x in xyzs]);refs=reference(matrix,train_ids)
    if not np.isfinite(matrix).all() or np.min(matrix)<=0:
        raise ValueError('bone lengths must be finite and strictly positive')
    scales,shape=scale_shape(matrix,refs)
    tree_refs={a+'->'+b:float(np.median([np.linalg.norm(nodes(xyzs[i])[b]-nodes(xyzs[i])[a]) for i in train_ids])) for a,b in TREE}
    rotation=np.array(inputs['rotation']['camera_rotation_world_to_camera_columns'])
    K=np.array(inputs['camera']['shared_early_result']['K'][0]);fx,fy=K[0,0],K[1,1]
    projection=rotation@np.diag([1,fy/fx,1]);principal=[K[0,2],K[1,2]]
    variants={'original':xyzs,
              'global_scale_removed':[{n:p/scales[i] for n,p in x.items()} for i,x in enumerate(xyzs)],
              'fixed_segment_lengths':[fixed_geometry(x,tree_refs) for x in xyzs]}
    direction_errors=[];fixed_length_errors=[]
    for original,fixed in zip(xyzs,variants['fixed_segment_lengths']):
        original,fixed=nodes(original),nodes(fixed)
        for a,b in TREE:
            x,y=original[b]-original[a],fixed[b]-fixed[a]
            direction_errors.append(float(np.linalg.norm(x/np.linalg.norm(x)-y/np.linalg.norm(y))))
            fixed_length_errors.append(abs(float(np.linalg.norm(y))-tree_refs[a+'->'+b]))
    assert max(direction_errors)<1e-12 and max(fixed_length_errors)<1e-12
    comparison={};fitted_rows={}
    for label,geometries in variants.items():
        data=[{**f,'world':np.array([g[n] for n in f['names']])} for f,g in zip(frames,geometries)]
        fit=base.fit_all([subset(f,FIT_NAMES) for f in data],projection,fx,principal)
        held=[score(subset(f,set(base.JOINTS)-FIT_NAMES),projection,fx,principal,r['params']) for f,r in zip(data,fit)]
        result={}
        for group,predicate in [('train',lambda r:r['frame']<=53),('later',lambda r:r['frame']>=63),('all',lambda r:True)]:
            result[group+'_fit']=base.aggregate([r for r in fit if predicate(r)])
            result[group+'_heldout']=base.aggregate([r for r in held if predicate(r)])
        result['events']={str(r['frame']):{'fit':r['metrics'],
            'heldout':base.metrics(h['residuals'],h['weights'],h['names']),
            'root_camera_xyz_model_units':r['root_camera_xyz_model_units']}
            for r,h in zip(fit,held) if r['frame'] in EVENTS}
        comparison[label]=result;fitted_rows[label]=(fit,held)
    gauge_errors=[float(np.abs(a['residuals']-b['residuals']).max()) for a,b in
                  zip(fitted_rows['original'][1],fitted_rows['global_scale_removed'][1])]
    assert max(gauge_errors)<1e-5
    regression=abs(comparison['original']['all_heldout']['weighted_rmse_px']-
                   inputs['prior_comparison']['external_fixed_K']['all_heldout']['weighted_rmse_px'])
    assert regression<1e-9
    bone_summaries={}
    for j,(name,a,b) in enumerate(EDGES):
        bone_summaries[name]={}
        for group,ids in [('train',train_ids),('later',[i for i,f in enumerate(frames) if f['frame']>=63]),('all',list(range(len(frames))))]:
            visible=[i for i in ids if (a in ['pelvis','thorax'] or a in frames[i]['names']) and
                                       (b in ['pelvis','thorax'] or b in frames[i]['names'])]
            bone_summaries[name][group]={'eligible_frame_count':len(visible),
                'length_model_units':describe(matrix[visible,j]),
                'scale_removed_ratio_to_train_ref':describe(shape[visible,j])}
            endpoint_names=([a] if a not in ['pelvis','thorax'] else
                            ['left_hip','right_hip'] if a=='pelvis' else ['left_shoulder','right_shoulder'])
            endpoint_names+=([b] if b not in ['pelvis','thorax'] else
                             ['left_hip','right_hip'] if b=='pelvis' else ['left_shoulder','right_shoulder'])
            high=[i for i in ids if all(raw_by_frame[frames[i]['frame']]['target_landmarks'][base.JOINTS[n]][3]>=.8 for n in endpoint_names)]
            bone_summaries[name][group]['image_visibility_at_least_0_8']={
                'count':len(high),'scale_removed_ratio_to_train_ref':describe(shape[high,j]) if high else None}
        bone_summaries[name]['train_reference_model_units']=float(refs[j])
    rows=[]
    image_matrix=np.stack([lengths(x) for x in image_nodes])
    for i,f in enumerate(frames):
        rows.append({'frame':f['frame'],'source_pts_s':f['source_pts_s'],'global_scale_factor':float(scales[i]),
           'lengths_model_units':{name:float(matrix[i,j]) for j,(name,_,_) in enumerate(EDGES)},
           'shape_ratios_after_global_scale_removed':{name:float(shape[i,j]) for j,(name,_,_) in enumerate(EDGES)},
           'image_lengths_px':{name:float(image_matrix[i,j]) for j,(name,_,_) in enumerate(EDGES)},
           'joint_visibility':{n:float(raw_by_frame[f['frame']]['target_landmarks'][idx][3]) for n,idx in base.JOINTS.items()}})
    symmetry={}
    for label in ['upper_arm','forearm','thigh','shin','heel','toe']:
        ids=[i for i,(n,_,_) in enumerate(EDGES) if n in ['left_'+label,'right_'+label]]
        symmetry[label]=describe(matrix[:,ids[0]]/matrix[:,ids[1]])
    report={'schema':'recreation2-world-bone-length-audit.v1','input_sha256':{str(p):base.digest(p) for p in paths.values()},
      'tool_sha256':base.digest(__file__),'dependency_tool_sha256':{Path(p).name:base.digest(p) for p in [base.__file__,str(Path(__file__).with_name('recreation2_effective_intrinsics_scale.py'))]},
      'frame_count':len(frames),'train_frame_max_inclusive':53,
      'global_scale_definition':'median of 11 core body edge ratios relative to per-edge training median',
      'global_scale_all':describe(scales),'global_scale_train':describe(scales[train_ids]),
      'bone_summaries':bone_summaries,'left_over_right_length_ratios':symmetry,
      'tree_reference_lengths_model_units':tree_refs,'fixed_camera_K':K.tolist(),'rotation_frozen':True,
      'comparison':comparison,'frames':rows,
      'verification':{**verify_synthetic(),'global_scale_reprojection_max_difference_px':max(gauge_errors),
                      'fixed_tree_direction_unit_vector_max_difference':max(direction_errors),
                      'fixed_tree_reference_length_max_difference':max(fixed_length_errors),
                      'prior_external_K_all_heldout_rmse_delta_px':regression},
      'limits':['world lengths are model outputs, not physical source bone measurements',
                '2D lengths vary with projection and cannot prove bone deformation',
                'global scale uses all 11 core edges including wrists without per-frame visibility weighting; counterfactual only, not strict holdout',
                'fixed tree reference uses training world joints including heldout points; not independent validation',
                'frozen rotation previously fitted with 16 points; current-step heldout diagnostic only',
                'all variants refit root from each frame; no metric camera depth or contact validation']}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'bone-length-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'scale':report['global_scale_all'],'comparison':{k:{t:v[t]['weighted_rmse_px'] for t in ['train_fit','train_heldout','later_fit','later_heldout']} for k,v in comparison.items()},'verification':report['verification']},indent=2))
if __name__=='__main__':main()
