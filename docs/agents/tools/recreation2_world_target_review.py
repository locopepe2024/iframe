"""Exact event-frame review against own-basis baseline with root frozen."""
import argparse
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text())


def main():
    ap = argparse.ArgumentParser()
    for key in ('candidate-report', 'baseline-report', 'candidate-bundle',
                'baseline-bundle', 'out'):
        ap.add_argument('--' + key, required=True)
    args = ap.parse_args()
    candidate = read(args.candidate_report)['cases']['world_candidate_root_frozen']
    baseline = read(args.baseline_report)['cases']['no_pelvis_own_basis_root']
    candidate_bundle = read(args.candidate_bundle)
    baseline_bundle = read(args.baseline_bundle)
    if len(candidate_bundle['frames']) != len(baseline_bundle['frames']):
        raise ValueError('candidate/baseline frame counts differ')
    for a, b in zip(candidate_bundle['frames'], baseline_bundle['frames'], strict=True):
        for key in ('frame', 'rootPosition', 'rootYaw'):
            if a[key] != b[key]:
                raise AssertionError(f'root freeze failed at {key}: {a[key]} != {b[key]}')
    if len(candidate) != len(baseline):
        raise ValueError('event row counts differ')
    rows = []
    for a, b in zip(candidate, baseline, strict=True):
        if a['source_frame'] != b['source_frame']:
            raise ValueError('event frame mismatch')
        if a['renderer_roundtrip_max_projection_difference_px'] >= .001:
            raise AssertionError('renderer roundtrip failed')
        if max(a['direction_residual_deg_before_render_root'].values()) >= .1:
            raise AssertionError('world directions were not solved')
        av, bv = a['joint_error_px'], b['joint_error_px']
        candidate_mean = a['mean_error_px']
        baseline_mean = b['mean_error_px']
        row = {
            'source_frame': a['source_frame'],
            'source_pts_s': a['source_pts_s'],
            'baseline_mean_error_px': baseline_mean,
            'candidate_mean_error_px': candidate_mean,
            'mean_error_delta_px': candidate_mean - baseline_mean,
            'baseline_bilateral_ankle_mean_px': (bv['left_ankle'] + bv['right_ankle']) / 2,
            'candidate_bilateral_ankle_mean_px': (av['left_ankle'] + av['right_ankle']) / 2,
            'baseline_shoulders_px': [bv['left_shoulder'], bv['right_shoulder']],
            'candidate_shoulders_px': [av['left_shoulder'], av['right_shoulder']],
            'per_joint_delta_px': {name: av[name] - bv[name] for name in av},
            'root_frozen_exact': True,
            'renderer_roundtrip_max_projection_difference_px': a['renderer_roundtrip_max_projection_difference_px'],
        }
        rows.append(row)
    report = {
        'schema': 'recreation2-world-target-review.v1',
        'comparison': 'same pinned rig, rootPosition, rootYaw, camera, frame anchors; no pelvis; own basis',
        'all_event_mean_errors_worse': all(r['mean_error_delta_px'] > 0 for r in rows),
        'all_event_bilateral_ankle_errors_worse': all(
            r['candidate_bilateral_ankle_mean_px'] > r['baseline_bilateral_ankle_mean_px'] for r in rows),
        'rows': rows,
        'limits': ['World-to-target orientation is an uncalibrated weak-perspective hypothesis', 'No metric camera depth, source root, physical sole contact, or H3 validation'],
    }
    Path(args.out).write_text(json.dumps(report, indent=2) + '\n')
    print('WORLD_TARGET_REVIEW_PASS', report['all_event_mean_errors_worse'],
          report['all_event_bilateral_ankle_errors_worse'], len(rows))


if __name__ == '__main__':
    main()
