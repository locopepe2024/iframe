"""Isolated diagnostics: CV camera x-right/y-down/z-forward, meters."""
from dataclasses import dataclass
import numpy as np

def rigid(matrix):
    m = np.asarray(matrix, dtype=float)
    if m.shape != (4, 4) or not np.isfinite(m).all():
        raise ValueError('finite 4x4 rigid transform required')
    r = m[:3, :3]
    if not np.allclose(m[3], [0, 0, 0, 1], atol=1e-10) or not np.allclose(r.T @ r, np.eye(3), atol=1e-10) or not np.isclose(np.linalg.det(r), 1, atol=1e-10):
        raise ValueError('proper rigid rotation required; no reflection/scale')
    return m

def transform(matrix, points):
    m = rigid(matrix)
    p = np.asarray(points, dtype=float)
    if p.ndim != 2 or p.shape[1] != 3 or not np.isfinite(p).all():
        raise ValueError('finite Nx3 points required')
    return p @ m[:3, :3].T + m[:3, 3]

@dataclass(frozen=True)
class Camera:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    world_to_camera: object

    def __post_init__(self):
        if not np.isfinite([self.width, self.height, self.fx, self.fy, self.cx, self.cy]).all() or min(self.width, self.height, self.fx, self.fy) <= 0:
            raise ValueError('valid intrinsics required')
        rigid(self.world_to_camera)

    def project(self, world_points):
        p = transform(self.world_to_camera, world_points)
        if (p[:, 2] <= 0).any():
            raise ValueError('points must be in front of camera')
        return p[:, :2] / p[:, 2:] * [self.fx, self.fy] + [self.cx, self.cy]

    def unproject(self, pixels, depth, *, depth_contract):
        if depth_contract != 'absolute_camera_z_m':
            raise ValueError('absolute metric camera Z required; relative proxy Z is insufficient')
        uv, z = np.asarray(pixels, dtype=float), np.asarray(depth, dtype=float)
        if uv.ndim != 2 or uv.shape[1] != 2 or z.shape != (len(uv),) or not np.isfinite(uv).all() or not np.isfinite(z).all() or (z <= 0).any():
            raise ValueError('finite pixels and positive absolute depths required')
        p = np.column_stack(((uv - [self.cx, self.cy]) / [self.fx, self.fy] * z[:, None], z))
        return transform(np.linalg.inv(rigid(self.world_to_camera)), p)

def local_basis(parent_world, rest_local, target_world):
    # Rigid/unit-scale, unconstrained hierarchy only. Real rigs need Blender API.
    return rigid(np.linalg.inv(rigid(rest_local)) @ np.linalg.inv(rigid(parent_world)) @ rigid(target_world))

def fk(parent_world, rest_local, basis):
    return rigid(rigid(parent_world) @ rigid(rest_local) @ rigid(basis))

def adapt_track_frame(frame, width, height):
    joints = frame['semantic_joints']
    if min(width, height) <= 0:
        raise ValueError('known image dimensions required')
    observations, proxy = {}, {}
    for name, xyz in joints.items():
        p = np.asarray(xyz, dtype=float)
        if p.shape != (3,) or not np.isfinite(p).all():
            raise ValueError('finite landmark XYZ required')
        observations[name] = [float(p[0] * width), float(p[1] * height)]
        proxy[name] = float(p[2])
    return {
        'source_frame': frame['source_frame'],
        'pts_seconds': frame['source_timestamp_seconds'],
        'image_observations': {'units': 'pixel', 'origin': 'top_left', 'width': width, 'height': height, 'joints': observations},
        'relative_depth_evidence': {'origin': 'hip_midpoint', 'units': 'mediapipe_normalized_proxy_not_meters', 'joints': proxy},
        'body_pose_3d': None, 'camera': None, 'root_trajectory': None, 'rig_calibration': None,
        'status': 'observations_only_metric_reconstruction_unavailable',
    }
