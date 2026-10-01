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
        # Proxy points are explicitly geometric fractions, not detected lumbar landmarks.
        raw = {
            'pelvis': hip,
            'spine_lower': lerp(hip, shoulder, 0.30),
            'spine_mid': lerp(hip, shoulder, 0.60),
            'spine_chest': lerp(hip, shoulder, 0.90),
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
