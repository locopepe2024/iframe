"""Derive CPU-only torso/spine proxy features from canonical motion-track.v1.

This is a geometric proxy, not a direct lumbar measurement. It creates three
virtual spine points between hip and shoulder centers and applies causal EMA
smoothing so Blender can validate torso continuity without a GPU model.
"""
import argparse, json, math
from pathlib import Path


def add(a, b): return [a[i] + b[i] for i in range(3)]
def sub(a, b): return [a[i] - b[i] for i in range(3)]
def mul(a, s): return [x * s for x in a]
def norm(a): return math.sqrt(sum(x * x for x in a))
def lerp(a, b, t): return [a[i] + (b[i] - a[i]) * t for i in range(3)]
def unit(a):
    n = norm(a)
    return [x / n for x in a] if n > 1e-8 else None

def project_perpendicular(vector, axis):
    direction = unit(axis)
    if direction is None: return vector
    scale = sum(vector[i] * direction[i] for i in range(3))
    return [vector[i] - direction[i] * scale for i in range(3)]

def center(j, left, right):
    if left not in j or right not in j: return None
    return mul(add(j[left], j[right]), 0.5)

def ema(previous, current, alpha):
    return current if previous is None else lerp(previous, current, alpha)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--alpha', type=float, default=0.35)
    ap.add_argument('--max-bend-ratio', type=float, default=0.08)
    args = ap.parse_args()
    if not 0 < args.alpha <= 1: raise SystemExit('--alpha must be in (0, 1]')
    data = json.loads(Path(args.input).read_text())
    previous = None
    frames = []
    for frame in data.get('frames', []):
        joints = frame.get('semantic_joints', {})
        hip = center(joints, 'left_hip', 'right_hip')
        shoulder = center(joints, 'left_shoulder', 'right_shoulder')
        if hip is None or shoulder is None:
            frames.append({'frame': frame.get('frame'), 'status': 'insufficient_joints', 'confidence': 0.0})
            continue
        torso = sub(shoulder, hip)
        pelvis_axis = sub(joints['right_hip'], joints['left_hip'])
        shoulder_axis = sub(joints['right_shoulder'], joints['left_shoulder'])
        # The difference between the shoulder and pelvis axes is the only
        # available CPU-only cue for a non-linear torso curve. It is a
        # constrained proxy, not a measured lumbar displacement.
        axis_delta = project_perpendicular(sub(shoulder_axis, pelvis_axis), torso)
        # Limit the lateral curve to avoid turning shoulder-axis jitter into
        # an implausible lumbar kink. This is a validation bound, not a claim
        # about human anatomical limits.
        scale = min(args.max_bend_ratio, 0.35 * norm(axis_delta) / max(norm(torso), 1e-8))
        bend = mul(unit(axis_delta) or [0.0, 0.0, 0.0], scale * max(norm(torso), 1e-8))
        # Proxy points are explicitly geometric fractions, not detected lumbar landmarks.
        raw = {
            'pelvis': hip,
            'spine_lower': add(lerp(hip, shoulder, 0.30), mul(bend, 0.35)),
            'spine_mid': add(lerp(hip, shoulder, 0.60), bend),
            'spine_chest': add(lerp(hip, shoulder, 0.90), mul(bend, 0.35)),
            'shoulder_center': shoulder,
        }
        smoothed = {name: ema(previous.get(name) if previous else None, point, args.alpha) for name, point in raw.items()}
        previous = smoothed
        confidence_values = [frame.get('joint_confidence', {}).get(name, 0.0) for name in ('left_hip','right_hip','left_shoulder','right_shoulder')]
        confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0.0
        frames.append({
            'frame': frame.get('frame'),
            'status': 'proxy',
            'confidence': confidence,
            'points': smoothed,
            'torso_vector': unit(torso),
            'torso_length': norm(torso),
            'source': 'hip_shoulder_geometric_proxy',
            'curve_source': 'pelvis_shoulder_axis_delta_hypothesis',
            'is_lumbar_measurement': False,
        })
    result = {
        'schema': 'motion-track-cpu-torso-proxy.v1',
        'source_track_revision': data.get('source_revision'),
        'estimation': {'mode': 'cpu_geometric_proxy', 'alpha': args.alpha, 'depth_is_directly_observed': False},
        'frames': frames,
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    valid = sum(f['status'] == 'proxy' for f in frames)
    print(json.dumps({'output': args.output, 'frames': len(frames), 'valid_proxy_frames': valid, 'ratio': valid / len(frames) if frames else 0}))

if __name__ == '__main__': main()
