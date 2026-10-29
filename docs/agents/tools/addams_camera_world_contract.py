"""Audit paired inferred GVHMR world/camera joints; no truth-camera claim.

Usage: python3 docs/agents/tools/addams_camera_world_contract.py
"""
import json
from pathlib import Path
import numpy as np

OUT = Path(__file__).resolve().parents[1] / 'raw/2026-10-29-addams-native-layered-v1'
native = json.loads((OUT / 'native-motion.json').read_text())
mapping = json.loads((OUT / 'frame-map.json').read_text())
world = np.asarray(native['motion']['global']['joints'])
camera = np.asarray(native['motion']['incam']['joints'])
assert world.shape == camera.shape == (len(mapping['frames']), 22, 3)
# Global SMPL +Y-up -> Blender +Z-up, determinant +1.
G = np.array(((1., 0., 0.), (0., 0., -1.), (0., 1., 0.)))
# Blender camera local +Y-up/-Z-forward -> computer-vision camera convention.
S = np.diag((1., -1., -1.))
rows = []
for i, (a, b) in enumerate(zip(world, camera)):
    ac, bc = a - a.mean(0), b - b.mean(0)
    u, singular, vt = np.linalg.svd(ac.T @ bc)
    parity = np.diag((1., 1., np.linalg.det(vt.T @ u.T)))
    rotation = vt.T @ parity @ u.T
    translation = b.mean(0) - rotation @ a.mean(0)
    predicted = a @ rotation.T + translation
    residual = np.linalg.norm(predicted - b, axis=1)
    # Unscaled camera-to-world matrix; multiply translation by the SAME rig scale.
    transform = np.eye(4)
    transform[:3, :3] = G @ rotation.T @ S
    transform[:3, 3] = G @ (-rotation.T @ translation)
    blender_world = a @ G.T
    local_camera = (blender_world - transform[:3, 3]) @ transform[:3, :3]
    replay = local_camera @ S.T
    projection_gap = np.max(np.linalg.norm(predicted[:, :2] / predicted[:, 2:] - b[:, :2] / b[:, 2:], axis=1))
    assert abs(np.linalg.det(rotation) - 1) < 1e-8
    assert np.max(residual) < 1e-5
    assert np.max(np.abs(replay - b)) < 1e-5
    rows.append({'model_frame': i, 'source_frame': mapping['frames'][i]['source_frame'],
                 'rigid_fit_max_model_units': float(np.max(residual)),
                 'normalized_projection_gap': float(projection_gap),
                 'world_to_cv_rotation': rotation.tolist(),
                 'world_to_cv_translation': translation.tolist(),
                 'blender_camera_to_world_unscaled': transform.tolist()})

samples = [min((r for r in mapping['frames'] if r['source_frame'] == sf),
               key=lambda r: abs(r['timing_error_s']))['model_frame'] for sf in (49, 52, 53)]
movements = []
for i in samples:
    movements.append({'source_frame': mapping['frames'][i]['source_frame'],
                     'global_root_delta': (world[i, 0] - world[samples[0], 0]).tolist(),
                     'global_right_ankle_delta': (world[i, 8] - world[samples[0], 8]).tolist(),
                     'global_right_foot_delta': (world[i, 11] - world[samples[0], 11]).tolist(),
                     'incam_right_foot_delta': (camera[i, 11] - camera[samples[0], 11]).tolist()})
report = {'schema': 'addams-camera-world-contract.v1', 'frames': rows,
          'max_rigid_residual_model_units': max(r['rigid_fit_max_model_units'] for r in rows),
          'max_normalized_projection_gap': max(r['normalized_projection_gap'] for r in rows),
          'movement_comparison': movements,
          'checks': {'proper_rigid_transform_all_frames': True,
                     'blender_camera_replay_all_frames': True},
          'limits': ['Derived from two model outputs, not physical camera calibration.',
                     'Global trajectory, gravity and contact remain inferred and unvalidated.',
                     'No focal length, camera pitch or absolute scene depth is measured.',
                     'Normalized projection agreement proves internal consistency only.',
                     'No production animation, rig or camera has been modified.']}
(OUT / 'camera-world-contract.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'frames'}, indent=2))
