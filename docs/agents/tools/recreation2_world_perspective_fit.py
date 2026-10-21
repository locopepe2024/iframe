"""Fit a fixed-axis perspective camera to paired MediaPipe image/world poses."""
import argparse
import hashlib
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
CALIBRATION_LAST_FRAME = 53
FOCAL_MIN_PX = 300.0
FOCAL_MAX_PX = 20000.0


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def percentile(values, q):
    return float(np.percentile(np.asarray(values, dtype=float), q))


def metrics(residuals, weights, names):
    errors = np.linalg.norm(residuals, axis=1)
    return {
        'weighted_rmse_px': float(np.sqrt(np.sum(weights * errors ** 2) / np.sum(weights))),
        'median_joint_error_px': percentile(errors, 50),
        'p90_joint_error_px': percentile(errors, 90),
        'max_joint_error_px': float(np.max(errors)),
        'per_joint_px': {name: float(value) for name, value in zip(names, errors)},
    }


def orthographic_fit(frame, rotation):
    camera = frame['world'] @ rotation
    target = frame['image']
    weights = frame['weights']
    total = float(np.sum(weights))
    x_mean = np.sum(camera[:, :2] * weights[:, None], axis=0) / total
    y_mean = np.sum(target * weights[:, None], axis=0) / total
    x_centered = camera[:, :2] - x_mean
    y_centered = target - y_mean
    scale = float(np.sum(weights[:, None] * x_centered * y_centered) /
                  np.sum(weights[:, None] * x_centered * x_centered))
    residuals = scale * x_centered + y_mean - target
    return {'scale_px_per_m': scale, 'residuals': residuals,
            'metrics': metrics(residuals, weights, frame['names'])}


def perspective_residuals(frame, rotation, focal, params, principal):
    tx, ty, log_depth = params
    depth = math.exp(float(log_depth))
    camera = frame['world'] @ rotation
    z = camera[:, 2] + depth
    if np.min(z) <= 1e-6 or not np.isfinite(z).all():
        return None
    x = camera[:, 0] + tx
    y = camera[:, 1] + ty
    predicted = np.column_stack((principal[0] + focal * x / z,
                                 principal[1] + focal * y / z))
    return predicted - frame['image'], x, y, z, depth


def fit_translation(frame, rotation, focal, principal, initial=None):
    camera = frame['world'] @ rotation
    weights = frame['weights']
    target = frame['image']
    total = float(np.sum(weights))
    if initial is None:
        ortho = orthographic_fit(frame, rotation)
        scale = max(ortho['scale_px_per_m'], 1e-6)
        depth0 = max(focal / scale, .05)
        image_mean = np.sum(target * weights[:, None], axis=0) / total
        camera_mean = np.sum(camera[:, :2] * weights[:, None], axis=0) / total
        tx0 = (image_mean[0] - principal[0]) * depth0 / focal - camera_mean[0]
        ty0 = (image_mean[1] - principal[1]) * depth0 / focal - camera_mean[1]
        params = np.array([tx0, ty0, math.log(depth0)], dtype=float)
    else:
        params = np.array(initial, dtype=float)

    sqrt_weights = np.repeat(np.sqrt(weights), 2)
    damping = 1e-3
    current = perspective_residuals(frame, rotation, focal, params, principal)
    if current is None:
        return None
    weighted = (current[0] * np.sqrt(weights[:, None])).ravel()
    cost = float(weighted @ weighted)
    for _ in range(80):
        residual, x, y, z, depth = current
        jac = np.zeros((2 * len(weights), 3), dtype=float)
        jac[0::2, 0] = focal / z
        jac[1::2, 1] = focal / z
        jac[0::2, 2] = -focal * x * depth / (z * z)
        jac[1::2, 2] = -focal * y * depth / (z * z)
        jac *= sqrt_weights[:, None]
        hessian = jac.T @ jac
        gradient = jac.T @ weighted
        diagonal = np.maximum(np.diag(hessian), 1e-10)
        try:
            delta = np.linalg.solve(hessian + damping * np.diag(diagonal), -gradient)
        except np.linalg.LinAlgError:
            break
        proposal = params + delta
        candidate = perspective_residuals(frame, rotation, focal, proposal, principal)
        if candidate is None:
            damping *= 10
            continue
        candidate_weighted = (candidate[0] * np.sqrt(weights[:, None])).ravel()
        candidate_cost = float(candidate_weighted @ candidate_weighted)
        if candidate_cost < cost:
            params, current, weighted, cost = proposal, candidate, candidate_weighted, candidate_cost
            damping = max(damping / 3, 1e-10)
            if np.linalg.norm(delta) < 1e-9:
                break
        else:
            damping = min(damping * 10, 1e12)
            if damping >= 1e11:
                break
    residual, _, _, z, depth = current
    return {
        'params': params,
        'residuals': residual,
        'metrics': metrics(residual, weights, frame['names']),
        'root_camera_xyz_model_units': [float(params[0]), float(params[1]), float(depth)],
        'hip_camera_depth_model_units': float(depth),
        'joint_depth_range_model_units': [float(np.min(z)), float(np.max(z))],
        'weighted_sse_px2': cost,
    }


def fit_all(data, rotation, focal, principal):
    rows = []
    for frame in data:
        fit = fit_translation(frame, rotation, focal, principal)
        if fit is None:
            raise RuntimeError(f'no positive-depth fit for frame {frame["frame"]}, focal {focal}')
        rows.append({**frame, **fit})
    return rows


def aggregate(rows):
    weights = np.concatenate([r['weights'] for r in rows])
    errors = np.concatenate([np.linalg.norm(r['residuals'], axis=1) for r in rows])
    return {
        'frame_count': len(rows),
        'weighted_rmse_px': float(np.sqrt(np.sum(weights * errors ** 2) / np.sum(weights))),
        'median_joint_error_px': percentile(errors, 50),
        'p90_joint_error_px': percentile(errors, 90),
        'max_joint_error_px': float(np.max(errors)),
    }


def parse_data(image_track, world_track, pts_map, width, height):
    images = {int(f['frame']): f for f in image_track['frames']}
    worlds = {int(f['frame']): f for f in world_track['frames']}
    pts = {int(f['track_frame']): float(f['source_pts_s']) for f in pts_map['sampled_track_frames']}
    if set(images) != set(worlds) or set(images) != set(pts):
        raise ValueError('image/world/PTS frames are not an exact paired set')
    frames = []
    for frame_no in sorted(images):
        image, world = images[frame_no], worlds[frame_no]
        for key in ('target_pose_index', 'selection_status'):
            if image.get(key) != world.get(key):
                raise ValueError(f'frame {frame_no} differs in {key}')
        if image['target_landmarks'] is None or world['target_world_landmarks'] is None:
            continue
        target_image, target_world, weights, names = [], [], [], []
        for name, index in JOINTS.items():
            a = image['target_landmarks'][index]
            b = world['target_world_landmarks'][index]
            confidence = float(a[3])
            if confidence < .2 or not np.isfinite(a[:3]).all() or not np.isfinite(b[:3]).all():
                continue
            target_image.append([float(a[0]) * width, float(a[1]) * height])
            target_world.append(b[:3])
            weights.append(confidence)
            names.append(name)
        if len(target_image) < 6:
            continue
        frames.append({
            'frame': frame_no,
            'source_pts_s': pts[frame_no],
            'timestamp_seconds': float(image['timestamp_seconds']),
            'landmark_count': len(target_image),
            'names': names,
            'image': np.asarray(target_image, dtype=float),
            'world': np.asarray(target_world, dtype=float),
            'weights': np.asarray(weights, dtype=float),
        })
    return frames


def profile_focal(data, rotation, principal, focal_values):
    records = []
    for focal in focal_values:
        fits = fit_all(data, rotation, float(focal), principal)
        train = [r for r in fits if r['frame'] <= CALIBRATION_LAST_FRAME]
        records.append({
            'focal_px': float(focal),
            'train': aggregate(train),
            'all': aggregate(fits),
            'median_train_hip_depth_model_units': percentile(
                [r['hip_camera_depth_model_units'] for r in train], 50),
            'median_all_hip_depth_model_units': percentile(
                [r['hip_camera_depth_model_units'] for r in fits], 50),
        })
    return records


def axis_rotation(axis, angle):
    c, s = math.cos(angle), math.sin(angle)
    if axis == 0:
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)
    if axis == 1:
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


def rotation_loss(data, rotation, focal, principal):
    return sum(fit_translation(frame, rotation, focal, principal)['weighted_sse_px2']
               for frame in data)


def refine_rotation(data, initial_rotation, focal, principal):
    best = np.asarray(initial_rotation, dtype=float).copy()
    best_loss = rotation_loss(data, best, focal, principal)
    iterations = 0
    step = math.radians(5)
    while step >= math.radians(.078125):
        improved = True
        while improved and iterations < 250:
            improved = False
            iterations += 1
            for axis in range(3):
                for sign in (-1, 1):
                    candidate = best @ axis_rotation(axis, sign * step)
                    loss = rotation_loss(data, candidate, focal, principal)
                    if loss < best_loss - max(1e-8, best_loss * 1e-11):
                        best, best_loss, improved = candidate, loss, True
        step *= .5
    return best, best_loss, iterations


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-track', required=True)
    parser.add_argument('--world-track', required=True)
    parser.add_argument('--consistency', required=True)
    parser.add_argument('--pts-map', required=True)
    parser.add_argument('--width', type=int, default=1394)
    parser.add_argument('--height', type=int, default=792)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    paths = {key: Path(getattr(args, key.replace('-', '_'))) for key in
             ('image-track', 'world-track', 'consistency', 'pts-map')}
    consistency = json.loads(paths['consistency'].read_text())
    image_track = json.loads(paths['image-track'].read_text())
    world_track = json.loads(paths['world-track'].read_text())
    pts_map = json.loads(paths['pts-map'].read_text())
    frames = parse_data(image_track, world_track, pts_map, args.width, args.height)
    q = np.asarray(consistency['shared_weak_perspective_camera']['world_to_pixel_basis_3x2'], dtype=float)
    rotation = np.column_stack((q, np.cross(q[:, 0], q[:, 1])))
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-6) or np.linalg.det(rotation) < .999999:
        raise ValueError('the inherited image basis is not a proper orthonormal camera basis')
    principal = [args.width / 2, args.height / 2]
    focal_values = np.geomspace(FOCAL_MIN_PX, FOCAL_MAX_PX, 41)
    calibration_frames = [frame for frame in frames if frame['frame'] <= CALIBRATION_LAST_FRAME]
    initial_profile = profile_focal(frames, rotation, principal, focal_values)
    initial_best = min(initial_profile, key=lambda row: row['train']['weighted_rmse_px'])
    rotation_after_first_fit, first_rotation_loss, first_rotation_iterations = refine_rotation(
        calibration_frames, rotation, initial_best['focal_px'], principal)
    second_profile = profile_focal(frames, rotation_after_first_fit, principal, focal_values)
    second_best = min(second_profile, key=lambda row: row['train']['weighted_rmse_px'])
    final_rotation, final_rotation_loss, final_rotation_iterations = refine_rotation(
        calibration_frames, rotation_after_first_fit, second_best['focal_px'], principal)
    profile = profile_focal(frames, final_rotation, principal, focal_values)
    best = min(profile, key=lambda row: row['train']['weighted_rmse_px'])
    best_index = profile.index(best)
    focal = best['focal_px']
    rotation_delta = rotation.T @ final_rotation
    rotation_delta_deg = math.degrees(math.acos(np.clip((np.trace(rotation_delta) - 1) / 2, -1, 1)))
    rotation_refinement = {
        'initial_focal_px': initial_best['focal_px'],
        'initial_train_rmse_px': initial_best['train']['weighted_rmse_px'],
        'after_first_rotation_focal_px': second_best['focal_px'],
        'after_first_rotation_train_rmse_px': second_best['train']['weighted_rmse_px'],
        'final_rotation_train_weighted_sse_px2': final_rotation_loss,
        'initial_rotation_train_weighted_sse_px2': rotation_loss(
            calibration_frames, rotation, focal, principal),
        'first_rotation_search_iterations': first_rotation_iterations,
        'final_rotation_search_iterations': final_rotation_iterations,
        'delta_from_weak_perspective_basis_deg': rotation_delta_deg,
        'final_world_to_camera_columns': final_rotation.tolist(),
        'procedure': 'coordinate search of one shared SO(3) camera rotation using calibration frames only; focal profiled between two refinements',
    }
    final_fits = fit_all(frames, final_rotation, focal, principal)
    fit_by_frame = {r['frame']: r for r in final_fits}
    train = [r for r in final_fits if r['frame'] <= CALIBRATION_LAST_FRAME]
    transition = [r for r in final_fits if 55 <= r['frame'] <= 61]
    later = [r for r in final_fits if r['frame'] >= 63]
    weak_rows = []
    for frame in frames:
        fit = orthographic_fit(frame, final_rotation)
        weak_rows.append({**frame, **fit})
    weak_by_frame = {r['frame']: r for r in weak_rows}

    near_best = [row for row in profile if row['train']['weighted_rmse_px'] <= best['train']['weighted_rmse_px'] * 1.01]
    frame_rows = []
    for frame in frames:
        persp, weak = fit_by_frame[frame['frame']], weak_by_frame[frame['frame']]
        frame_rows.append({
            'frame': frame['frame'],
            'source_pts_s': frame['source_pts_s'],
            'extractor_timestamp_s': frame['timestamp_seconds'],
            'timestamp_minus_source_pts_s': frame['timestamp_seconds'] - frame['source_pts_s'],
            'landmark_count': frame['landmark_count'],
            'perspective': {
                **persp['metrics'],
                'root_camera_xyz_model_units': persp['root_camera_xyz_model_units'],
                'hip_camera_depth_model_units': persp['hip_camera_depth_model_units'],
                'joint_depth_range_model_units': persp['joint_depth_range_model_units'],
            },
            'orthographic': {**weak['metrics'], 'scale_px_per_model_unit': weak['scale_px_per_m']},
            'per_joint_perspective_minus_orthographic_px': {
                name: float(np.linalg.norm(persp['residuals'][i]) - np.linalg.norm(weak['residuals'][i]))
                for i, name in enumerate(frame['names'])
            },
        })

    report = {
        'schema': 'recreation2-world-perspective-camera-fit.v1',
        'input_sha256': {key: digest(path) for key, path in paths.items()},
        'tool_sha256': digest(__file__),
        'paired_detected_frames': len(frames),
        'input_sample_frames': len(image_track['frames']),
        'missing_world_or_image_frames': len(image_track['frames']) - len(frames),
        'image_size_px': [args.width, args.height],
        'principal_point_px': principal,
        'pixel_aspect': 1.0,
        'distortion': 'fixed zero',
        'camera_rotation_initial_columns': rotation.tolist(),
        'camera_rotation_world_to_camera_columns': final_rotation.tolist(),
        'camera_rotation_refinement': rotation_refinement,
        'camera_rotation_source': 'initialized from existing source-frames-1-to-53 shared weak-perspective fit; refined only on source frames 1-53; not target-rig calibration',
        'world_scale_assumption': 'pose_world_landmarks numeric units treated as metres; this is model output, not independently measured scale',
        'focal_search_px': [FOCAL_MIN_PX, FOCAL_MAX_PX],
        'calibration_window': {'sample_frame_max_inclusive': CALIBRATION_LAST_FRAME,
                               'source_pts_max_s': max(r['source_pts_s'] for r in train)},
        'validation_protocol': 'focal and shared camera rotation are selected using sample frames <=53; for later frames those global parameters are frozen, but each frame root translation is still fitted from that frame\'s landmarks',
        'selected_focal_px': focal,
        'selected_focal_is_search_boundary': best_index in (0, len(profile) - 1),
        'selected_focal_profile_row': best,
        'focal_profile_within_1pct_train_rmse': {
            'candidate_count': len(near_best),
            'focal_min_px': min(r['focal_px'] for r in near_best),
            'focal_max_px': max(r['focal_px'] for r in near_best),
            'train_rmse_min_px': min(r['train']['weighted_rmse_px'] for r in near_best),
            'train_rmse_max_px': max(r['train']['weighted_rmse_px'] for r in near_best),
            'median_train_depth_min_model_units': min(r['median_train_hip_depth_model_units'] for r in near_best),
            'median_train_depth_max_model_units': max(r['median_train_hip_depth_model_units'] for r in near_best),
        },
        'focal_profile': profile,
        'comparison': {
            'perspective_train': aggregate(train),
            'orthographic_train': aggregate([weak_by_frame[r['frame']] for r in train]),
            'perspective_transition_55_to_61': aggregate(transition) if transition else None,
            'orthographic_transition_55_to_61': aggregate([weak_by_frame[r['frame']] for r in transition]) if transition else None,
            'perspective_later_63_plus': aggregate(later) if later else None,
            'orthographic_later_63_plus': aggregate([weak_by_frame[r['frame']] for r in later]) if later else None,
            'perspective_all': aggregate(final_fits),
            'orthographic_all': aggregate(weak_rows),
        },
        'event_frames': {str(f): next(r for r in frame_rows if r['frame'] == f)
                         for f in (1, 17, 23, 29, 41, 55) if f in fit_by_frame},
        'frames': frame_rows,
        'limits': [
            'image and world landmarks come from the same MediaPipe model and are not independent ground truth',
            'focal and camera rotation are selected only on sample frames <=53; later frames reuse those global parameters but refit root translation from each frame',
            'principal point, square pixels, zero distortion, world-to-camera rotation, and world scale are fixed assumptions',
            'root translation is estimated per frame; no static-world trajectory, floor, contact, target rig, or body proportions are imposed',
            'lateral root coordinates depend on the assumed principal point; a flat focal profile means absolute depth and focal are not separately supported by these observations',
        ],
    }
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({
        'selected_focal_px': focal,
        'boundary': report['selected_focal_is_search_boundary'],
        'train_perspective_rmse_px': report['comparison']['perspective_train']['weighted_rmse_px'],
        'train_orthographic_rmse_px': report['comparison']['orthographic_train']['weighted_rmse_px'],
        'later_perspective_rmse_px': report['comparison']['perspective_later_63_plus']['weighted_rmse_px'],
        'later_orthographic_rmse_px': report['comparison']['orthographic_later_63_plus']['weighted_rmse_px'],
        'near_best_focal_px': [report['focal_profile_within_1pct_train_rmse']['focal_min_px'],
                               report['focal_profile_within_1pct_train_rmse']['focal_max_px']],
    }, indent=2))


if __name__ == '__main__':
    main()
