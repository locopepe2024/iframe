"""Evaluate external effective K without selecting it from pose residuals."""
import argparse
import json
from pathlib import Path
import numpy as np
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES,EVENTS,subset,score

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--camera-report',required=True);ap.add_argument('--out',required=True);a=ap.parse_args()
    external=json.loads(Path(a.camera_report).read_text())
    oldpath=ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json'
    old=json.loads(oldpath.read_text())
    trackpath=ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json'
    track=json.loads(trackpath.read_text());ptspath=trackpath.with_name('pts-map.json')
    frames=base.parse_data(track,track,json.loads(ptspath.read_text()),*old['image_size_px'])
    rotation=np.array(old['camera_rotation_world_to_camera_columns'])
    fixedpath=ROOT/'docs/agents/raw/2026-10-22-effective-intrinsics-scale/report.json'
    fixed=json.loads(fixedpath.read_text())
    reference=fixed['reference_length']['value_model_units']
    def evaluate(K):
        fx,fy=K[0,0],K[1,1];principal=[K[0,2],K[1,2]]
        assert fx>0 and fy>0 and np.allclose(K[2],[0,0,1])
        # Exact fy handling: scale camera Y and its free translation together.
        projection_basis=rotation@np.diag([1,fy/fx,1])
        fits=base.fit_all([subset(f,FIT_NAMES) for f in frames],projection_basis,fx,principal)
        held=[score(subset(f,set(base.JOINTS)-FIT_NAMES),projection_basis,fx,principal,r['params']) for f,r in zip(frames,fits)]
        result={'K':K.tolist()}
        for name,predicate in [('train',lambda r:r['frame']<=53),('later',lambda r:r['frame']>=63),('all',lambda r:True)]:
            result[name+'_fit']=base.aggregate([r for r in fits if predicate(r)])
            result[name+'_heldout']=base.aggregate([r for r in held if predicate(r)])
        result['events']={}
        for r,h in zip(fits,held):
            if r['frame'] not in EVENTS:continue
            xyz=np.array(r['root_camera_xyz_model_units']);xyz[1]*=fx/fy
            result['events'][str(r['frame'])]={'source_pts_s':r['source_pts_s'],
                'fit_rmse_px':r['metrics']['weighted_rmse_px'],
                'heldout':base.metrics(h['residuals'],h['weights'],h['names']),
                'root_xyz_reference_units':(xyz/reference).tolist()}
        return result
    K=np.array(external['shared_early_result']['K'][0],dtype=float)
    result=evaluate(K)
    sensitivity=[]
    for factor in (.9,1.1):
        alternate=K.copy();alternate[0,0]*=factor;alternate[1,1]*=factor
        sensitivity.append({'focal_factor':factor,**evaluate(alternate)})
    # Independent synthetic check for non-square pixels and off-center principal point.
    rng=np.random.default_rng(22);w=rng.uniform(-.5,.5,(16,3));xyz=w+[.2,-.1,4.]
    fxt,fyt=1000.,1250.;ct=[710.,360.]
    uv=np.column_stack([ct[0]+fxt*xyz[:,0]/xyz[:,2],ct[1]+fyt*xyz[:,1]/xyz[:,2]])
    syn={'world':w[:8],'image':uv[:8],'weights':np.ones(8),'names':list(map(str,range(8)))}
    syn_basis=np.diag([1,fyt/fxt,1]);fit=base.fit_translation(syn,syn_basis,fxt,ct)
    check=base.perspective_residuals({'world':w[8:],'image':uv[8:]},syn_basis,fxt,fit['params'],ct)[0]
    max_error=float(np.abs(check).max());assert max_error<1e-8
    report={'schema':'recreation2-external-effective-camera-compare.v1',
        'input_sha256':{str(p):base.digest(p) for p in (Path(a.camera_report),oldpath,trackpath,ptspath,fixedpath)},
        'tool_sha256':base.digest(__file__),'reference_length_model_units':reference,
        'dependency_tool_sha256':{str(Path(p).name):base.digest(p) for p in (base.__file__,str(Path(__file__).with_name('recreation2_effective_intrinsics_scale.py')))},
        'external_K_source':'GeoCalib first five full frames shared intrinsics, no pose-residual selection',
        'rotation_source':'prior same-model training rotation, frozen; GeoCalib gravity not applied',
        'external_fixed_K':result,'external_focal_sensitivity':sensitivity,
        'baseline_1449_center':fixed['baseline_fixed_1449_center'],
        'verification':{'non_square_known_camera_heldout_max_error_px':max_error},
        'limits':['same-model image/world points; inherited rotation was fitted using all 16 joints, so held-out points are current-step diagnostics, not strict holdout or independent ground truth',
            'external focal and principal frozen, but per-frame root refitted from eight joints',
            'reference units only; no metric distance, ground contact, target rig or H3 validation']}
    Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'external_K':K.tolist(),'train_heldout':result['train_heldout'],
        'later_heldout':result['later_heldout'],'verification':report['verification']},indent=2))
if __name__=='__main__':main()
