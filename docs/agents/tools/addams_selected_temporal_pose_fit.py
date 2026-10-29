"""Bounded leg-only sequence fit; selected-frame holdout, fixed native camera.
Run in the existing GVHMR environment on media. No rig or production writes.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from hmr4d.utils.smplx_utils import make_smplx

BASE = Path('/tmp/addams-pose/gvhmr-native-v1')
OUT = BASE / 'selected-temporal-fit-v1'
OUT.mkdir(exist_ok=True)
fusion_path = BASE / 'selected-temporal-input.json'
fusion = json.loads(fusion_path.read_text())
inp = json.loads((BASE / 'native-layer-input.json').read_text())
mapping = inp['frame_map']['frames']
pred = torch.load(BASE / 'hmr4d_results.pt', map_location='cpu')
params = pred['smpl_params_incam']
# Keep each prediction at its native model timestamp; no axis-angle resampling.
rows = [r for r in mapping if 49 <= r['source_frame'] <= 56]
indices = [r['model_frame'] for r in rows]
F = len(rows)
body0 = params['body_pose'].detach().reshape(-1, 21, 3)[indices]
glob = params['global_orient'].detach().reshape(-1, 3)[indices]
trans = params['transl'].detach().reshape(-1, 3)[indices]
betas = params['betas'].detach()[indices]
K = inp['camera_K']
fx, fy, cx, cy = K[0][0], K[1][1], K[0][2], K[1][2]
torch.set_num_threads(4)
model = make_smplx('supermotion_v437coco17').eval()
for p in model.parameters():
    p.requires_grad_(False)
names = {'left_knee': 13, 'right_knee': 14, 'left_ankle': 15}
records = []
for name, data in fusion['groups']['joint_center'].items():
    if name not in names:
        continue
    for sf, xy in data['observations'].items():
        candidates = [(k, r) for k, r in enumerate(rows) if r['source_frame'] == int(sf)]
        if not candidates:
            continue
        k, r = min(candidates, key=lambda v: abs(v[1]['timing_error_s']))
        records.append({'source_frame': int(sf), 'model_frame': r['model_frame'],
                        'sequence_index': k, 'joint': name, 'joint_index': names[name],
                        'xy': xy, 'timing_error_s': r['timing_error_s']})
pose_indices = [0, 1, 3, 4]  # left/right hip and knee only

def evaluate(body):
    _, joints = model(body.reshape(1, F, 63), betas.unsqueeze(0),
                      glob.unsqueeze(0), trans.unsqueeze(0))
    j = joints[0]
    xy = torch.stack((fx*j[..., 0]/j[..., 2], fy*j[..., 1]/j[..., 2]), -1)
    return j, xy + torch.tensor([cx, cy])

with torch.no_grad():
    base_j, base_xy = evaluate(body0)

def fit(bound, holdout):
    train = [r for r in records if r['source_frame'] != holdout]
    delta = torch.zeros(F, 4, 3, requires_grad=True)
    opt = torch.optim.Adam([delta], lr=.015)
    for step in range(220):
        opt.zero_grad()
        body = body0.clone()
        body[:, pose_indices] += delta
        joints, xy = evaluate(body)
        residuals = torch.stack([xy[r['sequence_index'], r['joint_index']] - torch.tensor(r['xy']) for r in train])
        # Robust pixel data loss, bounded pose prior, and temporal correction prior.
        loss = (torch.sqrt(residuals.square().sum(-1) + 4) - 2).mean()
        loss += 2*delta.square().mean() + 8*torch.diff(delta, n=2, dim=0).square().mean()
        loss.backward()
        opt.step()
        with torch.no_grad():
            delta.clamp_(-bound, bound)
    with torch.no_grad():
        body = body0.clone()
        body[:, pose_indices] += delta
        joints, xy = evaluate(body)
    scores = []
    for r in records:
        k, j = r['sequence_index'], r['joint_index']
        scores.append({**r, 'split': 'heldout' if r['source_frame'] == holdout else 'train',
                       'baseline_px': float((base_xy[k,j]-torch.tensor(r['xy'])).norm()),
                       'fitted_px': float((xy[k,j]-torch.tensor(r['xy'])).norm())})
    def metrics(split):
        selected = [r for r in scores if r['split'] == split]
        return {'count': len(selected), **{key: float(np.sqrt(np.mean([r[key]**2 for r in selected]))) for key in ['baseline_px', 'fitted_px']}}
    return {'bound_rad_per_component': bound, 'holdout_source_frame': holdout,
            'metrics': {s: metrics(s) for s in ['train', 'heldout']}, 'scores': scores,
            'delta_axis_angle': delta.detach().tolist(),
            'body_pose_axis_angle': body.tolist(), 'joints_camera_m': joints.tolist(),
            'projection_xy': xy.tolist(),
            'bound_component_fraction': float((delta.detach().abs() >= bound-1e-5).float().mean()),
            'max_relative_hip_change_m': float(((joints[:,[11,12]]-joints[:,[11,12]].mean(1,keepdim=True))-(base_j[:,[11,12]]-base_j[:,[11,12]].mean(1,keepdim=True))).abs().max())}

result = {'schema': 'addams-selected-temporal-pose-fit.v1', 'production_eligible': False,
          'input_sha256': hashlib.sha256(fusion_path.read_bytes()).hexdigest(),
          'camera': {'fx':fx,'fy':fy,'cx':cx,'cy':cy,'fixed':True},
          'frame_map':rows, 'source_range':[49,56], 'baseline_projection_xy':base_xy.tolist(),
          'cases':[],'limits':[
              'Selected candidates are human preferences, not independent 3D ground truth.',
              'Frame51 withheld from pose objective; upstream model may have observed it.',
              'Camera uses native intrinsics, no annotation-derived camera calibration.',
              'Only hips and knees changed; global pose, root, shape, camera unchanged.',
              'Shoe proxies excluded; no contact, ground, lighting or target-rig acceptance.',
              'Axis-angle component bounds are diagnostic limits, not anatomical constraints.',
              'Original30fps samples retained; source-frame timing errors are reported.',
              'No evidence beyond frame56 extrapolated; frame64 flight not addressed.']}
for bound in [.35, .7]:
    case = fit(bound, 51)
    result['cases'].append(case)
    (OUT/'report.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'bound':bound,'metrics':case['metrics'],'bound_fraction':case['bound_component_fraction']}),flush=True)
