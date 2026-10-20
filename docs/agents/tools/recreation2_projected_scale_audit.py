"""Read-only 2D length grouping and common-scale adequacy audit."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def stats(values):
    values = sorted(values)
    def q(p):
        pos = (len(values)-1)*p
        lo, hi = math.floor(pos), math.ceil(pos)
        return values[lo]+(values[hi]-values[lo])*(pos-lo)
    return dict(count=len(values), min=values[0], median=q(.5), p95=q(.95), max=values[-1])


def lengths(points):
    result = {name: math.dist(points[f'left_{part}'], points[f'right_{part}'])
              for name, part in [('shoulder_width','shoulder'), ('hip_width','hip')]}
    centers = {part: [(points[f'left_{part}'][i]+points[f'right_{part}'][i])/2 for i in (0,1)] for part in ('hip','shoulder')}
    result['torso_midpoints'] = math.dist(centers['hip'], centers['shoulder'])
    for side in ('left','right'):
        for start,end in [('shoulder','elbow'),('elbow','wrist'),('hip','knee'),('knee','ankle')]:
            result[f'{side}_{start}_{end}'] = math.dist(points[f'{side}_{start}'], points[f'{side}_{end}'])
    return result


def main():
    p=argparse.ArgumentParser()
    for k in ('report','track','out'): p.add_argument('--'+k, type=Path, required=True)
    a=p.parse_args()
    report=json.loads(a.report.read_text());track=json.loads(a.track.read_text())
    case=report['cases']['z_full']
    # The experiment uses a two-second slice; source_revision ties it to the full track.
    assert report['baseline_channels_exact_match'] and report['candidate_root_and_keys_exact_match']
    # Verify that every consumed XY equals the frozen experiment's source scoring.
    source={f['source_frame']:f['semantic_joints'] for f in track['frames']}
    rows=[]
    for row in case['source_observations']:
        assert row.get('kind') != 'hold_until_next_pts'
        sf=row['source_frame']; output=case['output'][row['new_bundle_frame']-1]['pixels']
        original={k:[v[0]*640,v[1]*360] for k,v in source[sf].items()}
        assert all(abs(math.dist(v,original[k])-row['per_joint_px'][k])<1e-6 for k,v in output.items()), 'Source XY mismatch'
        actual,expected=lengths(output),lengths(original)
        assert all(v>1e-6 for v in expected.values())
        scale=sum(actual[k]*expected[k] for k in actual)/sum(v*v for v in actual.values())
        entries={k:dict(rig_length_px=v, source_length_px=expected[k], ratio=v/expected[k],
                        signed_error_px=v-expected[k], required_scale=expected[k]/v,
                        after_common_scale_signed_error_px=scale*v-expected[k]) for k,v in actual.items()}
        rows.append(dict(source_frame=sf, common_length_fit_scale=scale, segments=entries))
    assert len(rows)==28 and len({r['source_frame'] for r in rows})==28
    groups={g:[e for r in rows for k,e in r['segments'].items() if k==g or k.endswith('_'+g)]
            for g in ('shoulder_width','hip_width','torso_midpoints','shoulder_elbow','elbow_wrist','hip_knee','knee_ankle')}
    summary={'groups':{g:{m:stats([e[m] for e in es]) for m in ('ratio','signed_error_px','required_scale','after_common_scale_signed_error_px')} for g,es in groups.items()},
             'per_frame_common_length_fit_scale':stats([r['common_length_fit_scale'] for r in rows]),
             'all_11_lengths_abs_error_before_px':stats([abs(e['signed_error_px']) for r in rows for e in r['segments'].values()]),
             'all_11_lengths_abs_error_after_per_frame_scale_px':stats([abs(e['after_common_scale_signed_error_px']) for r in rows for e in r['segments'].values()])}
    result={'schema':'recreation2-projected-scale.v1','sha256':{k:hashlib.sha256(v.read_bytes()).hexdigest() for k,v in [('input_report',a.report),('track',a.track),('probe',Path(__file__))]},
            'source_revision':track['source_revision'],'input_experiment_sha256':report['sha256'],
            'limits':['2D length-only fit; no new poses','Per-frame scale is an optimistic diagnostic, not recovered camera or physical bone scale','Midpoint proxy is average of projected endpoints'],
            'summary':summary,'rows':rows}
    a.out.mkdir(parents=True,exist_ok=True)
    (a.out/'report.json').write_text(json.dumps(result,indent=2)+'\n')
    (a.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    for g,es in groups.items(): print(g, 'ratio median',round(summary['groups'][g]['ratio']['median'],3),'signed median',round(summary['groups'][g]['signed_error_px']['median'],2))
    print('common scale',summary['per_frame_common_length_fit_scale'])
    for k in ('all_11_lengths_abs_error_before_px','all_11_lengths_abs_error_after_per_frame_scale_px'):print(k,summary[k])
    for r in rows:
        if r['source_frame'] in (1,17,23,29,41,55):print(r['source_frame'],round(r['common_length_fit_scale'],3),{k:round(e['ratio'],3) for k,e in r['segments'].items()})


if __name__=='__main__': main()
