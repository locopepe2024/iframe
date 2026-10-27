"""Decompose saved leg projections; does not solve or change any motion."""
import hashlib
import json
import math
import statistics
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
RAW=ROOT/'docs/agents/raw'
OUT=RAW/'2026-10-28-leg-segment-audit'
EVENTS=[1,17,23,29,41,55]

def sub(a,b): return [a[i]-b[i] for i in range(2)]
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def norm(a): return math.hypot(*a)
def med(a): return statistics.median(a)
def main():
    OUT.mkdir(exist_ok=True)
    bp=RAW/'2026-10-20-root-yaw/report.json'
    ip=RAW/'2026-10-22-independent-pose/report.json'
    baseline_report=json.loads(bp.read_text())
    cases=baseline_report['cases']
    code_hashes={}
    for name,filename in [('builder','build_full_body_bundle_blender.py'),('renderer','render_full_motion_bundle.py')]:
        cp=ROOT/'scripts/director3d'/filename
        code_hashes[name]=hashlib.sha256(cp.read_bytes()).hexdigest()
        assert code_hashes[name]==baseline_report[name+'_sha256']
    knee_deltas=[]
    for old,new in zip(cases['raw_root_yaw']['output'],cases['raw_own_root_yaw']['output'],strict=True):
        assert old['output_frame']==new['output_frame']
        for j in ['left_hip','right_hip','left_knee','right_knee']:
            knee_deltas.append(math.dist(old['pixels'][j],new['pixels'][j]))
    assert max(knee_deltas)==0
    source={f['source_frame']:f for f in json.loads(ip.read_text())['frames']}
    rows=[]; checks=[]
    # Same root/yaw solving mode and original XYZ. Only rotation basis differs.
    for case in ['raw_root_yaw','raw_own_root_yaw']:
        c=cases[case]; obs={o['source_frame']:o for o in c['source_observations']}
        output={o['output_frame']:o['pixels'] for o in c['output']}
        for f in EVENTS:
            t=output[obs[f]['new_bundle_frame']]
            for model,points in [('mp',source[f]['mediapipe_pixels']),('rtm',source[f]['roi_variants']['1.0']['joint_pixels'])]:
                s={j:[p[0]*640/1394,p[1]*360/792] for j,p in points.items()}
                for side in ['left','right']:
                    for segment,start,end in [('thigh','hip','knee'),('shin','knee','ankle')]:
                        a,b=side+'_'+start,side+'_'+end
                        sv,tv=sub(s[b],s[a]),sub(t[b],t[a]); sl,tl=norm(sv),norm(tv)
                        u=[v/sl for v in sv]; parallel=dot(tv,u)-sl; perpendicular=u[0]*tv[1]-u[1]*tv[0]
                        e0,e1=sub(t[a],s[a]),sub(t[b],s[b]); residual=sub(tv,sv)
                        checks.append(abs(norm(residual)**2-parallel**2-perpendicular**2))
                        checks.append(norm(sub(sub(e1,e0),residual)))
                        rows.append(dict(case=case,source_frame=f,model=model,side=side,segment=segment,source_length_px=sl,target_length_px=tl,length_ratio=tl/sl,angle_deg=math.degrees(math.atan2(sv[0]*tv[1]-sv[1]*tv[0],dot(sv,tv))),parallel_residual_px=parallel,perpendicular_residual_px=perpendicular,segment_vector_residual_px=norm(residual),start_error_xy=e0,end_error_xy=e1))
    summary={}
    for case in ['raw_root_yaw','raw_own_root_yaw']:
        summary[case]={}
        for model in ['mp','rtm']:
            summary[case][model]={}
            for segment in ['thigh','shin']:
                r=[r for r in rows if r['case']==case and r['model']==model and r['segment']==segment]
                summary[case][model][segment]={k:med([abs(x[k]) if k=='angle_deg' else x[k] for x in r]) for k in ['source_length_px','target_length_px','length_ratio','angle_deg','parallel_residual_px','perpendicular_residual_px','segment_vector_residual_px']}
    knees=[]
    for f in EVENTS:
        item={'source_frame':f}
        for case in ['raw_root_yaw','raw_own_root_yaw']:
            item[case]={part:med([v for o in cases[case]['source_observations'] if o['source_frame']==f for j,v in o['per_joint_px'].items() if j.endswith('_'+part)]) for part in ['hip','knee','ankle']}
        knees.append(item)
    report=dict(schema='recreation2-leg-segment-audit.v1',units='640x360 pixel coordinates; degrees; ratios dimensionless',events=EVENTS,input_sha256={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [bp,ip]},identity_max_error=max(checks),basis_comparison_hip_knee_max_delta_px=max(knee_deltas),current_code_hashes_match_original=code_hashes,definitions={'parallel':'dot(target_vector, source_unit)-source_length; combines length and angle','perpendicular':'cross(source_unit, target_vector); signed screen-space perpendicular residual','identity':'end_point_error = start_point_error + segment_vector_residual; ||residual||^2 = parallel^2 + perpendicular^2'},summary=summary,event_joint_errors_mp=knees,rows=rows,limits=['No new rig or camera solve','Rotation-basis candidate changes multiple bones; not knee-only isolation','Projection length is not physical bone length','No causal attribution from signed residual decomposition'])
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'identity_max_error':max(checks),'summary':summary,'events':knees},indent=2))
if __name__=='__main__': main()
