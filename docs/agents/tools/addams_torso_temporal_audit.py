"""Audit frozen torso candidates without fitting, smoothing or truth claims."""
import hashlib
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'docs/agents/raw/2026-10-28-motion-asset-package'
OUT = BASE / 'addams-fixed-rig'


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def norm(v):
    return math.sqrt(sum(x*x for x in v))


def midpoint(points):
    return [(a+b)/2 for a, b in zip(points['left_shoulder'], points['right_shoulder'])]


def velocity(a, b, dt):
    assert dt > 0
    return [x/dt for x in sub(b, a)]


def summary(values):
    return {'median': statistics.median(values), 'max': max(values)}


def project_midpoint(xyz, translation):
    return [sum(960*(xyz[s+'_shoulder'][k]+translation[k]) /
                (xyz[s+'_shoulder'][2]+translation[2])+[480, 260][k]
                for s in ['left', 'right'])/2 for k in range(2)]


def main():
    paths = [OUT/'distributed-score.json', OUT/'distributed-control.json',
             BASE/'addams-pose-media/observations.json']
    scores, control, observations = [json.loads(p.read_text()) for p in paths]
    obs = {r['source_frame']: r for r in observations}
    raw = {(r['case'], r['source_frame']): r for r in control['rows']}
    cases = list(scores['summary'])
    rows, identities = [], []
    for r in scores['rows']:
        pred, source = r['predicted'], r['source']
        v = sub(pred['right_shoulder'], pred['left_shoulder'])
        w = sub(source['right_shoulder'], source['left_shoulder'])
        dot = sum(a*b for a, b in zip(v, w))
        mid = sub(midpoint(pred), midpoint(source))
        terms = {'midpoint': norm(mid)**2, 'width': (norm(v)-norm(w))**2/4,
                 'direction': (norm(v)*norm(w)-dot)/2}
        identities.append(abs(sum(terms.values())-r['shoulder_rmse_px']**2))
        sf = r['source_frame']
        rows.append({'case': r['case'], 'source_frame': sf,
                     'pts_s': obs[sf]['source_pts_s'], 'terms_px2': terms,
                     'shoulder_rmse_px': r['shoulder_rmse_px'],
                     'midpoint_residual_xy_px': mid,
                     'width_ratio': norm(v)/norm(w),
                     'line_error_deg': math.degrees(math.atan2(w[0]*v[1]-w[1]*v[0], dot)),
                     'mp_visibility_min': min(obs[sf]['mediapipe'][j]['visibility'] for j in [11, 12])})
    assert max(identities) < 1e-7
    temporal, summaries = [], {}
    for case in cases:
        selected = sorted((r for r in rows if r['case'] == case), key=lambda r: r['pts_s'])
        for a, b in zip(selected, selected[1:]):
            assert b['source_frame'] == a['source_frame']+1
            dt = b['pts_s']-a['pts_s']
            ca, cb = [raw[case, x['source_frame']]['xyz_right_down_forward'] for x in [a, b]]
            sa, sb = [next(r for r in scores['rows'] if r['case'] == case and r['source_frame'] == x['source_frame']) for x in [a, b]]
            pv = velocity(midpoint(sa['predicted']), midpoint(sb['predicted']), dt)
            sv = velocity(midpoint(sa['source']), midpoint(sb['source']), dt)
            # Ordered exact decomposition, not an order-independent causal attribution.
            pa = project_midpoint(ca, sa['translation'])
            intermediate = project_midpoint(cb, sa['translation'])
            pb = project_midpoint(cb, sb['translation'])
            pose_step, translation_step = sub(intermediate, pa), sub(pb, intermediate)
            assert norm(sub(sub(pb, pa), [x+y for x, y in zip(pose_step, translation_step)])) < 1e-8
            assert norm(sub(pa, midpoint(sa['predicted']))) < 1e-8
            temporal.append({'case': case, 'frames': [a['source_frame'], b['source_frame']], 'dt_s': dt,
                             'shoulder_midpoint_speed_model_units_s': norm(velocity(midpoint(ca), midpoint(cb), dt)),
                             'projected_midpoint_speed_px_s': norm(pv),
                             'source_midpoint_speed_px_s': norm(sv),
                             'midpoint_velocity_residual_px_s': norm(sub(pv, sv)),
                             'pose_step_at_previous_translation_px': pose_step,
                             'translation_step_at_current_pose_px': translation_step,
                             'translation_delta_model_units': sub(sb['translation'], sa['translation'])})
        ts = [r for r in temporal if r['case'] == case]
        summaries[case] = {'rmse_px': summary([r['shoulder_rmse_px'] for r in selected]),
                           'sum_terms_px2': {k: sum(r['terms_px2'][k] for r in selected) for k in ['midpoint', 'width', 'direction']},
                           'temporal': {k: summary([r[k] for r in ts]) for k in ['shoulder_midpoint_speed_model_units_s', 'midpoint_velocity_residual_px_s']},
                           'worst_velocity_interval': max(ts, key=lambda r: r['midpoint_velocity_residual_px_s'])['frames']}
    indexed = {(r['case'], r['source_frame']): r for r in rows}
    comparisons = []
    for sf in sorted({r['source_frame'] for r in rows}):
        a, b = [indexed[c, sf] for c in ['distributed_swing', 'distributed_twist']]
        comparisons.append({'source_frame': sf, 'rmse_delta_px': b['shoulder_rmse_px']-a['shoulder_rmse_px'],
                            'terms_delta_px2': {k: b['terms_px2'][k]-a['terms_px2'][k] for k in a['terms_px2']}})
    # Behavioral checks: signed component changes must reproduce total squared-error changes.
    for r in comparisons:
        a, b = [indexed[c, r['source_frame']] for c in ['distributed_swing', 'distributed_twist']]
        assert abs(sum(r['terms_delta_px2'].values())-(b['shoulder_rmse_px']**2-a['shoulder_rmse_px']**2)) < 1e-7
    assert velocity([1, 2], [3, 6], .5) == [4, 8]
    report = {'input_sha256': {str(p.relative_to(BASE)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
              'scope': {'first_frame': min(r['source_frame'] for r in rows), 'last_frame': max(r['source_frame'] for r in rows),
                        'duration_s': max(r['pts_s'] for r in rows)-min(r['pts_s'] for r in rows)},
              'identity_max_error_px2': max(identities), 'summary': summaries, 'twist_minus_swing': comparisons,
              'rows': rows, 'temporal': temporal,
              'limits': ['MP shoulders construct the candidates; residuals are not independent truth.',
                         'MP visibility scores are not human visibility annotations.',
                         'Finite difference speed includes intended motion and estimation error; not a jitter verdict.',
                         'Projection uses per-frame fitted translations; model-space speed is hip-relative.',
                         'Pose/translation displacement decomposition applies pose first; reversing order changes the components.',
                         'No mesh, contact, camera or full-clip validation; no candidate selected.']}
    (OUT/'torso-temporal-audit.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'scope': report['scope'], 'summary': summaries,
                      'twist_improved_frames': sum(r['rmse_delta_px'] < 0 for r in comparisons),
                      'twist_worsened_frames': sum(r['rmse_delta_px'] > 0 for r in comparisons)}, indent=2))


if __name__ == '__main__':
    main()
