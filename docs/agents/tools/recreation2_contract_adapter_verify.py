"""Behavioral closed-loop checks; no Blender/real-video accuracy claim."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import numpy as np
from recreation2_contract_adapter import Camera, adapt_track_frame, fk, local_basis, rigid, transform

def pose(axis, degrees, translation=(0, 0, 0)):
    a = np.asarray(axis, dtype=float); a /= np.linalg.norm(a)
    x, y, z = a; k = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    t = np.deg2rad(degrees); m = np.eye(4)
    m[:3, :3] += np.sin(t) * k + (1 - np.cos(t)) * (k @ k)
    m[:3, 3] = translation
    return rigid(m)

def reject(action):
    try:
        action()
    except ValueError:
        return True
    raise AssertionError('invalid contract was accepted')

def verify():
    cam = Camera(1394, 792, 1200, 1170, 683, 401, pose([1, 0, 0], 9, (.1, -.2, .4)))
    rest = [pose([1, 1, 0], 23, (0, .15, 0)), pose([0, 1, 1], -31, (.18, .24, .03)), pose([1, 0, 1], 17, (-.12, .27, .04))]
    basis = [pose([1, 2, 3], 26), pose([3, 1, 2], -37), pose([2, 3, 1], 19)]
    maximum = {'xyz_m': 0., 'rotation_matrix': 0., 'endpoint_m': 0., 'pixel': 0., 'bone_length_m': 0.}
    count = 0
    for depth, offset, yaw in itertools.product((3., 5., 8.), (-1., 0., 1.), (0., 30., 60., 80.)):
        parent = pose([0, 1, 0], yaw, (offset, .2, depth)); recovered_parent = parent.copy()
        for r, b in zip(rest, basis):
            target = parent @ r @ b
            solved = local_basis(recovered_parent, r, target)
            assert np.allclose(solved[:3, 3], 0, atol=1e-12)
            recovered = fk(recovered_parent, r, solved)
            # Endpoints include a side offset: full orientation/twist matters.
            points = np.array([[0, 0, 0], [0, .32, 0], [.09, .32, .04]])
            expected, actual = transform(target, points), transform(recovered, points)
            uv = cam.project(expected)
            camera_z = transform(cam.world_to_camera, expected)[:, 2]
            restored = cam.unproject(uv, camera_z, depth_contract='absolute_camera_z_m')
            errors = {'xyz_m': float(np.max(np.abs(restored - expected))), 'rotation_matrix': float(np.max(np.abs(recovered[:3, :3] - target[:3, :3]))), 'endpoint_m': float(np.max(np.linalg.norm(actual - expected, axis=1))), 'pixel': float(np.max(np.linalg.norm(cam.project(actual) - uv, axis=1))), 'bone_length_m': float(abs(np.linalg.norm(actual[1]-actual[0])-.32))}
            for name, value in errors.items():
                maximum[name] = max(maximum[name], value)
                assert value < 1e-9, (name, value)
            parent, recovered_parent = target, recovered
        count += 1
    parent = pose([0, 1, 0], 53, (.3, .2, 5))
    target = parent @ rest[0] @ basis[0]
    omitted_rest = parent @ rest[0] @ (np.linalg.inv(parent) @ target)
    omitted_root = parent @ rest[0] @ local_basis(np.eye(4), rest[0], target)
    axis = np.array([[0., 1., 0.]])
    twisted = target @ pose([0, 1, 0], 60)
    direction_error = float(np.linalg.norm(transform(target, axis)-target[:3, 3] - (transform(twisted, axis)-twisted[:3, 3])))
    side = np.array([[.15, .3, 0.]])
    side_error = float(np.linalg.norm(transform(target, side)-transform(twisted, side)))
    controls = {'omitted_rest_matrix_error': float(np.max(np.abs(omitted_rest-target))), 'omitted_root_matrix_error': float(np.max(np.abs(omitted_root-target))), 'same_direction_twist_direction_error': direction_error, 'same_direction_twist_endpoint_error_m': side_error}
    assert controls['omitted_rest_matrix_error'] > .01 and controls['omitted_root_matrix_error'] > .01
    assert direction_error < 1e-12 and side_error > .1
    rejected = {
        'relative_z_as_absolute': reject(lambda: cam.unproject([[1, 2]], [1], depth_contract='hip_relative_proxy')),
        'nonpositive_depth': reject(lambda: cam.unproject([[1, 2]], [0], depth_contract='absolute_camera_z_m')),
        'reflection': reject(lambda: rigid(np.diag([-1, 1, 1, 1]))),
        'scaled_rotation': reject(lambda: rigid(np.diag([2, 1, 1, 1]))),
        'missing_parent': reject(lambda: local_basis(None, rest[0], target)),
        'invalid_intrinsics': reject(lambda: Camera(1394, 792, 0, 1170, 683, 401, np.eye(4))),
    }
    return {'cases': count, 'bones_per_case': 3, 'max_errors': maximum, 'negative_controls': controls, 'contract_rejections': rejected}

def main():
    p = argparse.ArgumentParser(); p.add_argument('--track', required=True); p.add_argument('--out', required=True); args = p.parse_args()
    report = verify()
    path = Path(args.track); track = json.loads(path.read_text())
    # Dimensions pinned to the previously ffprobe-verified source, not inferred from coordinates.
    frames = [adapt_track_frame(f, 1394, 792) for f in track['frames']]
    max_roundtrip = 0.
    for source, adapted in zip(track['frames'], frames):
        assert all(adapted[k] is None for k in ('body_pose_3d', 'camera', 'root_trajectory', 'rig_calibration'))
        for name, xyz in source['semantic_joints'].items():
            uv = adapted['image_observations']['joints'][name]
            max_roundtrip = max(max_roundtrip, abs(uv[0]/1394-xyz[0]), abs(uv[1]/792-xyz[1]))
            assert adapted['relative_depth_evidence']['joints'][name] == xyz[2]
    assert max_roundtrip < 1e-15
    selected = [f['source_frame'] for f in frames if f['source_frame'] in (1, 17, 23, 29, 55)]
    assert selected == [1, 17, 23, 29, 55], selected
    report.update({'schema': 'recreation2-contract-adapter-verification.v1', 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'observation_frames': len(frames), 'selected_source_frames_present': selected, 'normalized_xy_roundtrip_error': max_roundtrip, 'limits': ['Synthetic rigid unit-scale unconstrained rig only; not Blender rig certification', 'Source camera/metric pose/root/rig calibration remain unknown', 'No real-video retarget improvement or contact validation measured']})
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    (out/'observations-only.json').write_text(json.dumps({'schema': 'recreation2-observations-only.v1', 'source_sha256': report['source_sha256'], 'dimension_provenance': 'prior ffprobe source evidence: 1394x792', 'frames': frames}, indent=2)+'\n')
    (out/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
