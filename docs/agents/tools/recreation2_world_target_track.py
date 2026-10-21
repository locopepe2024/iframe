"""Map hip-relative MediaPipe world landmarks into target-camera direction inputs."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

JOINTS = {
    'left_shoulder': 11, 'right_shoulder': 12, 'left_elbow': 13, 'right_elbow': 14,
    'left_wrist': 15, 'right_wrist': 16, 'left_hip': 23, 'right_hip': 24,
    'left_knee': 25, 'right_knee': 26, 'left_ankle': 27, 'right_ankle': 28,
    'left_heel': 29, 'right_heel': 30, 'left_foot_index': 31, 'right_foot_index': 32,
}


def normalize(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise ValueError('degenerate axis')
    return v / n


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--world', required=True)
    ap.add_argument('--image-track', required=True)
    ap.add_argument('--consistency', required=True)
    ap.add_argument('--renderer-report', required=True)
    ap.add_argument('--anchors', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--fps', type=float, default=24.)
    args = ap.parse_args()
    world_path, image_path = Path(args.world), Path(args.image_track)
    consistency = json.loads(Path(args.consistency).read_text())
    renderer_report = json.loads(Path(args.renderer_report).read_text())
    world = json.loads(world_path.read_text())
    image_track = json.loads(image_path.read_text())
    anchors = json.loads(Path(args.anchors).read_text())
    world_frames = {f['frame']: f for f in world['frames']}
    image_frames = {f['source_frame']: f for f in image_track['frames']}
    projection = consistency['shared_weak_perspective_camera']['world_to_pixel_basis_3x2']
    q = np.asarray(projection, dtype=float)
    camera_rotation = np.column_stack((q, np.cross(q[:, 0], q[:, 1])))
    camera_rows = renderer_report['renderer_camera']['right_down_forward_world_axes']
    target_axes = np.asarray(camera_rows, dtype=float).T
    if not np.allclose(target_axes.T @ target_axes, np.eye(3), atol=1e-8):
        raise ValueError('renderer camera axes are not orthonormal')
    # Convert source camera-aligned directions into target Blender world axes.
    mapping = camera_rotation @ target_axes.T
    if not np.allclose(mapping.T @ mapping, np.eye(3), atol=1e-8) or np.linalg.det(mapping) < .999999:
        raise ValueError('world to target mapping must be proper orthonormal rotation')
    # Matches builder BASIS: input column -> Blender-like (dx,dz,-dy).
    builder_basis = np.array([[1., 0., 0.], [0., 0., 1.], [0., -1., 0.]])
    output_frames = []
    algebra_error = 0.
    anchor_frames = {int(a['source_frame']) for a in anchors}
    for image in image_track['frames']:
        source_frame = int(image['source_frame'])
        if source_frame not in anchor_frames:
            continue
        if source_frame not in image_frames or source_frame not in world_frames:
            raise ValueError(f'missing paired landmarks at source frame {source_frame}')
        image = image_frames[source_frame]
        wm = world_frames[source_frame]['target_world_landmarks']
        if wm is None or len(wm) != 33:
            raise ValueError(f'invalid world pose at source frame {source_frame}')
        hip = (np.asarray(wm[23][:3], dtype=float) + np.asarray(wm[24][:3], dtype=float)) * .5
        if not np.isfinite(hip).all():
            raise ValueError('nonfinite hip center')
        joints = {}
        confidence = {}
        for name, index in JOINTS.items():
            if name not in image['semantic_joints'] or float(image['joint_confidence'].get(name, 0)) < .2:
                continue
            point = np.asarray(wm[index][:3], dtype=float)
            if not np.isfinite(point).all():
                continue
            stage = (point - hip) @ mapping
            # builder maps input difference by BASIS; invert that mapping here.
            builder_input = stage @ builder_basis
            joints[name] = builder_input.tolist()
            confidence[name] = float(image['joint_confidence'][name])
            projected = stage @ target_axes[:, :2]
            expected = (point - hip) @ q
            algebra_error = max(algebra_error, float(np.max(np.abs(projected - expected))))
        output_frames.append({
            'frame': source_frame, 'source_frame': source_frame,
            'source_timestamp_seconds': image['source_timestamp_seconds'],
            'selection_status': image['selection_status'],
            'semantic_joints': joints,
            'joint_confidence': confidence,
        })
    if algebra_error > 1e-7:
        raise AssertionError(algebra_error)
    output = {
        'schema': 'motion-track-world-direction-diagnostic.v1',
        'track_id': 'mediapipe-world-pose-camera-aligned-diagnostic',
        'source_revision': sha(world_path),
        'coordinate_system': {'input': 'target-camera-direction-proxy', 'units': 'direction-only; root frozen externally'},
        'source': {'world_track_sha256': sha(world_path), 'image_track_sha256': sha(image_path),
                   'world_to_target_rotation': mapping.tolist(), 'camera_rotation_world_to_pixel': camera_rotation.tolist(),
                   'target_camera_axes': target_axes.tolist(),
                   'renderer_report_sha256': sha(args.renderer_report),
                   'builder_basis_inverse': builder_basis.tolist(),
                   'algebra_projection_max_abs_error': algebra_error,
                   'hypothesis': 'weak-perspective basis fitted from the same model on track frames 1-53; not calibrated source camera'},
        'frames': output_frames,
    }
    Path(args.out).write_text(json.dumps(output, indent=2) + '\n')
    print('WORLD_TARGET_TRACK_PASS', len(output_frames), 'frames', 'algebra_error', algebra_error,
          'det', float(np.linalg.det(mapping)))


if __name__ == '__main__':
    main()
