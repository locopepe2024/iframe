"""Trace upstream leg directions through fixed-length endpoint reconstruction."""
import hashlib
import json
import math
from pathlib import Path
from addams_perspective_probe import fit

BASE=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-fixed-rig'

def sub(a,b): return [x-y for x,y in zip(a,b)]
def norm(a): return math.sqrt(sum(v*v for v in a))
def unit(a): return [v/norm(a) for v in a]
def add(a,b): return [x+y for x,y in zip(a,b)]
def mul(a,s): return [x*s for x in a]

def main():
    paths=[BASE/'addams-pose-media/world-candidate.json',OUT/'distributed-control.json',OUT/'fixed-rig-report.json',OUT/'distributed-score.json']
    world,control,rig,score=[json.loads(p.read_text()) for p in paths]
    ws={r['source_frame']:r['pose_world_landmarks'][0] for r in world['frames'] if r['pose_world_landmarks']}
    cs={r['source_frame']:r for r in control['rows'] if r['case']=='distributed_swing'}
    ss={r['source_frame']:r for r in score['rows'] if r['case']=='distributed_swing'}
    rows=[];maxgap=0
    for sf in range(20,24):
        pts=[[p[k] for k in 'xyz'] for p in ws[sf]]
        for side,ids,suffix in [('left',[23,25,27],'l'),('right',[24,26,28],'r')]:
            xyz=cs[sf]['xyz_right_down_forward'];h,k,a=[xyz[side+'_'+n] for n in ['hip','knee','ankle']]
            segments=[];pred=h
            for i,bone in enumerate(['upper_leg','lower_leg']):
                v=sub(pts[ids[i+1]],pts[ids[i]]);actual=sub([k,a][i],[h,k][i]);length=rig['rest_lengths'][bone+'_'+suffix]
                reconstructed=mul(unit(v),length);pred=add(pred,reconstructed)
                gap=norm(sub(reconstructed,actual));maxgap=max(maxgap,gap)
                segments.append({'bone':bone,'source_vector':v,'source_length':norm(v),'rig_length':length,
                                 'length_ratio':length/norm(v),'rig_vector':actual,'direction_closure_error_units':gap})
            rows.append({'source_frame':sf,'side':side,'source_hip_to_ankle':sub(pts[ids[2]],pts[ids[0]]),
                         'rig_hip_to_ankle':sub(a,h),'endpoint_closure_error_units':norm(sub(pred,a)), 'segments':segments})
    assert maxgap<1e-5,maxgap
    # Exact ordered change decomposition L*u: length at old direction, then direction at new length.
    changes=[]
    for side in ['left','right']:
        before,after=[next(r for r in rows if r['source_frame']==sf and r['side']==side) for sf in [21,22]]
        details=[]
        for a,b in zip(before['segments'],after['segments']):
            ua,ub=unit(a['source_vector']),unit(b['source_vector'])
            length_step=mul(ua,b['source_length']-a['source_length'])
            direction_step=mul(sub(ub,ua),b['source_length'])
            assert norm(sub(add(length_step,direction_step),sub(b['source_vector'],a['source_vector'])))<1e-9
            details.append({'bone':a['bone'],'source_length_step':length_step,'source_direction_step':direction_step,
                            'direction_change_deg':math.degrees(math.acos(max(-1,min(1,sum(x*y for x,y in zip(ua,ub)))))),
                            'rig_vector_delta':sub(b['rig_vector'],a['rig_vector'])})
        changes.append({'side':side,'source_hip_to_ankle_delta':sub(after['source_hip_to_ankle'],before['source_hip_to_ankle']),
                        'rig_hip_to_ankle_delta':sub(after['rig_hip_to_ankle'],before['rig_hip_to_ankle']), 'segments':details})
    # Keep frame22 hips and directions; freeze ONLY segment lengths to per-frame source lengths or prior-source lengths.
    names=[n for n in ss[22]['source'] if n.endswith(('hip','ankle'))];cases=[]
    for mode in ['rig_lengths','source_lengths_22','source_lengths_21']:
        xyz={n:list(v) for n,v in cs[22]['xyz_right_down_forward'].items()}
        for side in ['left','right']:
            r=next(r for r in rows if r['source_frame']==22 and r['side']==side);p=xyz[side+'_hip']
            old=next(r for r in rows if r['source_frame']==21 and r['side']==side)
            for i,seg in enumerate(r['segments']):
                length=seg['rig_length'] if mode=='rig_lengths' else (seg['source_length'] if mode=='source_lengths_22' else old['segments'][i]['source_length'])
                p=add(p,mul(unit(seg['source_vector']),length));xyz[side+['_knee','_ankle'][i]]=p
        v=fit(ss[22]['source'],xyz,960,names)
        cases.append({'case':mode,'depth':v['translation'][2],'rmse_px':v['fit_rmse_px']})
    report={'coordinates':'source MP xyz equals diagnostic right/down/forward after Blender x,z,-y roundtrip; proper rotation determinant+1',
            'max_segment_closure_error_units':maxgap,'rows':rows,'changes_21_to_22':changes,'length_counterfactuals':cases,
            'input_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
            'limits':['Direction closure verifies mapping, not correctness of upstream3D.',
                      'Source lengths are model estimates; mixed lengths and rig hips are not a valid calibrated body.',
                      'Counterfactual depth changes include body-size changes; not recovered camera calibration.',
                      'No manual ankle identity/contact truth or originalL3 mesh validation.']}
    (OUT/'leg-mapping-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['max_segment_closure_error_units','changes_21_to_22','length_counterfactuals']},indent=2))

if __name__=='__main__':main()
