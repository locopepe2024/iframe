"""Best-fit weak-perspective consistency of paired MediaPipe 2D/world outputs."""
import argparse
import json
import math
from pathlib import Path

import numpy as np

JOINTS = {
    'left_shoulder': 11, 'right_shoulder': 12, 'left_elbow': 13, 'right_elbow': 14,
    'left_wrist': 15, 'right_wrist': 16, 'left_hip': 23, 'right_hip': 24,
    'left_knee': 25, 'right_knee': 26, 'left_ankle': 27, 'right_ankle': 28,
    'left_heel': 29, 'right_heel': 30, 'left_foot_index': 31, 'right_foot_index': 32,
}


def prepare(old_frame, paired_frame, width, height):
    if old_frame['target_landmarks'] is None or paired_frame['target_world_landmarks'] is None:
        return None
    image, world, weights, names = [], [], [], []
    for name, index in JOINTS.items():
        a = old_frame['target_landmarks'][index]
        b = paired_frame['target_world_landmarks'][index]
        if len(a) < 4 or len(b) < 4:
            continue
        confidence = float(a[3])
        if confidence < .2:
            continue
        if not np.isfinite(a[:3]).all() or not np.isfinite(b[:3]).all():
            continue
        image.append([a[0] * width, a[1] * height])
        world.append(b[:3])
        weights.append(confidence)
        names.append(name)
    if len(image) < 6:
        return None
    return {'frame': old_frame['frame'], 'image': np.array(image, dtype=float),
            'world': np.array(world, dtype=float), 'weights': np.array(weights),
            'names': names}


def fit_rotation(data):
    total = np.zeros((3, 2)); denom = 0.
    for d in data:
        w = d['weights']; x = d['world']; y = d['image']
        xm = (x * w[:, None]).sum(0) / w.sum()
        ym = (y * w[:, None]).sum(0) / w.sum()
        xc, yc = x - xm, y - ym
        total += xc.T @ (yc * w[:, None])
        denom += float((w[:, None] * xc * xc).sum())
    u, _, vt = np.linalg.svd(total, full_matrices=False)
    q = u @ vt
    if np.linalg.det(q.T @ q) < .999999:
        raise AssertionError('projection basis lost orthonormality')
    return q, denom


def evaluate(d, q):
    x, y, w = d['world'], d['image'], d['weights']
    xm = (x * w[:, None]).sum(0) / w.sum()
    ym = (y * w[:, None]).sum(0) / w.sum()
    xc, yc = x - xm, y - ym
    z = xc @ q
    scale = float((w[:, None] * z * yc).sum() / (w[:, None] * z * z).sum())
    pred = z * scale + ym
    residual = np.linalg.norm(pred - y, axis=1)
    return {'scale_px_per_m': scale,
            'weighted_rmse_px': float(np.sqrt((w * residual**2).sum() / w.sum())),
            'median_joint_error_px': float(np.median(residual)),
            'p90_joint_error_px': float(np.percentile(residual, 90)),
            'max_joint_error_px': float(np.max(residual)),
            'per_joint_px': {name: float(v) for name, v in zip(d['names'], residual)}}


def axis_rotation(axis, angle):
    c, s = math.cos(angle), math.sin(angle)
    if axis == 0:
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)
    if axis == 1:
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


def full_rotation(q):
    return np.column_stack((q, np.cross(q[:, 0], q[:, 1])))


def orientation_loss(data, rotation):
    return sum(evaluate(d, rotation[:, :2])['weighted_rmse_px'] ** 2 *
               float(d['weights'].sum()) for d in data)


def refine_orientation(data, initial_rotations):
    best = min((np.asarray(r, dtype=float) for r in initial_rotations),
               key=lambda r: orientation_loss(data, r)).copy()
    best_loss = orientation_loss(data, best)
    iterations = 0
    step = math.radians(45)
    min_step = math.radians(.08789)
    while step >= min_step:
        improved = True
        while improved and iterations < 300:
            improved = False
            iterations += 1
            for axis in range(3):
                for sign in (-1, 1):
                    candidate = best @ axis_rotation(axis, sign * step)
                    loss = orientation_loss(data, candidate)
                    if loss < best_loss - max(1e-10, best_loss * 1e-12):
                        best, best_loss, improved = candidate, loss, True
        step *= .5
    return best, best_loss, iterations


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', required=True)
    ap.add_argument('--paired', required=True)
    ap.add_argument('--pts-map', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--width', type=int, required=True)
    ap.add_argument('--height', type=int, required=True)
    args = ap.parse_args()
    old, paired = json.loads(Path(args.old).read_text()), json.loads(Path(args.paired).read_text())
    a = {f['frame']: f for f in old['frames']}
    b = {f['frame']: f for f in paired['frames']}
    assert set(a) == set(b)
    data, pose_matches, xy_max, missing_world = [], 0, 0., 0
    for frame in sorted(a):
        x, y = a[frame], b[frame]
        assert x['target_pose_index'] == y['target_pose_index']
        assert x['selection_status'] == y['selection_status']
        pose_matches += 1
        if x['target_landmarks'] is None:
            assert y['target_landmarks'] is None
        else:
            assert len(x['target_landmarks']) == len(y['target_landmarks'])
            xy_max = max(xy_max, max(abs(float(p[k]) - float(q[k]))
                                     for p, q in zip(x['target_landmarks'], y['target_landmarks'])
                                     for k in range(4)))
        d = prepare(x, y, args.width, args.height)
        if d is None:
            missing_world += 1
        else:
            data.append(d)
    assert xy_max == 0.
    pts_map = json.loads(Path(args.pts_map).read_text())
    pts_by_frame = {int(x['track_frame']): float(x['source_pts_s'])
                    for x in pts_map['sampled_track_frames']}
    assert set(pts_by_frame) == set(a)
    train_data = [d for d in data if d['frame'] <= 53]
    assert len(train_data) > 10
    shared_seed, _ = fit_rotation(train_data)
    reference_rotation, shared_loss, shared_iterations = refine_orientation(
        train_data, [full_rotation(shared_seed)])
    shared_rows = []
    timestamp_errors = []
    free_rotations = {}
    for d in data:
        q, _ = fit_rotation([d])
        candidate, loss, iterations = refine_orientation(
            [d], [reference_rotation, full_rotation(q)])
        assert loss <= orientation_loss([d], reference_rotation) + 1e-7
        free_rotations[d['frame']] = candidate
        delta = reference_rotation.T @ candidate
        orientation_delta = math.degrees(math.acos(np.clip((np.trace(delta) - 1) / 2, -1, 1)))
        frame_time = float(b[d['frame']]['timestamp_seconds'])
        timestamp_error = frame_time - pts_by_frame[d['frame']]
        timestamp_errors.append(timestamp_error)
        shared_rows.append({'frame': d['frame'], 'source_pts_s': pts_by_frame[d['frame']],
                            'paired_extractor_timestamp_s': frame_time,
                            'paired_timestamp_minus_source_pts_s': timestamp_error,
                            'best_fit_orientation_delta_from_1_to_53_deg': orientation_delta,
                            'free_fit_iterations': iterations,
                            **evaluate(d, reference_rotation[:, :2])})
    per_frame_rows = []
    for d in data:
        per_frame_rows.append({'frame': d['frame'], **evaluate(d, free_rotations[d['frame']][:, :2])})
    all_errors = [row['weighted_rmse_px'] for row in shared_rows]
    free_errors = [row['weighted_rmse_px'] for row in per_frame_rows]
    groups = {}
    for name, predicate in (
        ('source_pts_0_to_before_1_959139_static_background_window', lambda f: f <= 53),
        ('source_pts_1_959139_to_2_17_background_motion_evidence', lambda f: 55 <= f <= 61),
        ('source_frame_63_on_later_sequence', lambda f: f >= 63),
    ):
        rows = [r for r in shared_rows if predicate(r['frame'])]
        errs = [r['weighted_rmse_px'] for r in rows]
        angles = [r['best_fit_orientation_delta_from_1_to_53_deg'] for r in rows]
        if rows:
            groups[name] = {
                'count': len(rows), 'frame_range': [rows[0]['frame'], rows[-1]['frame']],
                'source_pts_range_s': [min(r['source_pts_s'] for r in rows),
                                       max(r['source_pts_s'] for r in rows)],
                'shared_basis_rmse_px_median': float(np.median(errs)),
                'shared_basis_rmse_px_p90': float(np.percentile(errs, 90)),
                'shared_basis_rmse_px_max': float(np.max(errs)),
                'free_orientation_rmse_px_median': float(np.median([
                    r['weighted_rmse_px'] for r in per_frame_rows
                    if rows[0]['frame'] <= r['frame'] <= rows[-1]['frame']])),
                'per_frame_best_fit_orientation_delta_deg_median': float(np.median(angles)),
                'per_frame_best_fit_orientation_delta_deg_p90': float(np.percentile(angles, 90)),
            }
    chosen = {f: next(r for r in shared_rows if r['frame'] == f)
              for f in (1, 17, 23, 29, 55)}
    report = {
        'schema': 'recreation2-world-projection-consistency.v1',
        'image_size_px': [args.width, args.height],
        'paired_frames': len(data), 'missing_world_or_image_frames': missing_world,
        'pose_index_and_status_exact_frames': pose_matches,
        'image_landmark_max_abs_difference': xy_max,
        'paired_timestamp_alignment': {
            'median_abs_timestamp_error_s': float(np.median(np.abs(timestamp_errors))),
            'p90_abs_timestamp_error_s': float(np.percentile(np.abs(timestamp_errors), 90)),
            'max_abs_timestamp_error_s': float(np.max(np.abs(timestamp_errors))),
            'meaning': 'paired VIDEO-mode timestamp compared with ffprobe PTS for the same decoded frame index',
        },
        'semantic_joints_used': list(JOINTS),
        'confidence_weight': 'same >=0.2 visibility eligibility as canonical semantic-track conversion; then weighted by visibility',
        'shared_weak_perspective_camera': {
            'assumption': 'one orthographic orientation fitted only on decoded track frames 1-53; frame-specific scale and 2D translation',
            'calibration_frames': [d['frame'] for d in train_data],
            'world_to_pixel_basis_3x2': reference_rotation[:, :2].tolist(),
            'orientation_search_iterations': shared_iterations,
            'per_frame_free_fit_invariant': 'each free-orientation residual is constrained to be no worse than the shared orientation on that frame',
            'weighted_rmse_px_median': float(np.median(all_errors)),
            'weighted_rmse_px_p90': float(np.percentile(all_errors, 90)),
            'weighted_rmse_px_max': float(np.max(all_errors)),
            'event_frames': chosen,
            'frames': shared_rows,
            'temporal_groups': groups,
        },
        'per_frame_free_orientation': {
            'assumption': 'orthographic orientation optimized independently per frame with each frame scale and translation refit; higher-freedom diagnostic, not a calibrated camera',
            'weighted_rmse_px_median': float(np.median(free_errors)),
            'weighted_rmse_px_p90': float(np.percentile(free_errors, 90)),
            'weighted_rmse_px_max': float(np.max(free_errors)),
            'frames': per_frame_rows,
        },
        'limits': ['Orthographic similarity only; no perspective intrinsics or distortion', 'Orientation coordinate search is a local numerical fit, not a camera calibration', 'World landmarks are model estimates, not independent ground truth', 'No retargeting, source-depth truth, or contact accuracy inferred'],
    }
    Path(args.out).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report['shared_weak_perspective_camera'][k] for k in ('weighted_rmse_px_median', 'weighted_rmse_px_p90', 'weighted_rmse_px_max')}))
    print(json.dumps({k: report['per_frame_free_orientation'][k] for k in ('weighted_rmse_px_median', 'weighted_rmse_px_p90', 'weighted_rmse_px_max')}))


if __name__ == '__main__':
    main()
