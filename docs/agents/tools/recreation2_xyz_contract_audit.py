"""Audit exact XYZ preservation; no retargeting or depth modification."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    normalizer = repo / 'scripts/director3d/normalize_motion_track.py'
    spec = importlib.util.spec_from_file_location('normalizer', normalizer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    paths = {name: args.artifacts / name for name in
             ('legacy-track.json', 'track.json', 'track-2s.json')}
    raw, full, window = [json.loads(p.read_text()) for p in paths.values()]
    reconstructed = module.convert(raw, paths['legacy-track.json'].read_bytes())
    assert reconstructed == full, 'Stored canonical track differs from current converter'
    raw_by_frame = {f['frame']: f for f in raw['frames']}
    full_by_frame = {f['source_frame']: f for f in full['frames']}
    checked = 0
    for f in full['frames']:
        landmarks = raw_by_frame[f['source_frame']]['target_landmarks']
        for joint, xyz in f['semantic_joints'].items():
            assert xyz == landmarks[module.JOINTS[joint]][:3]
            checked += 3
    window_checked = 0
    for f in window['frames']:
        expected = full_by_frame[f['source_frame']]['semantic_joints']
        assert f['semantic_joints'] == expected
        window_checked += 3 * len(expected)
    width, height = raw['source']['width'], raw['source']['height']
    hip_depths = [(f['semantic_joints']['left_hip'][2] +
                   f['semantic_joints']['right_hip'][2]) / 2
                  for f in window['frames']
                  if all(k in f['semantic_joints'] for k in ('left_hip', 'right_hip'))]
    result = {
        'schema': 'recreation2-xyz-contract-audit.v1',
        'sha256': {name: digest(p) for name, p in paths.items()},
        'normalizer_sha256': digest(normalizer),
        'source_revision_matches_raw': full['source_revision'] == digest(paths['legacy-track.json']),
        'full_conversion_exact_match': True,
        'raw_to_full_coordinate_count': checked,
        'raw_to_full_max_abs_difference': 0,
        'full_to_window_coordinate_count': window_checked,
        'full_to_window_max_abs_difference': 0,
        'source_dimensions': [width, height],
        'image_y_to_width_units_factor': height / width,
        'uncompensated_y_relative_scale': width / height,
        'window_hip_mean_proxy_z_range': [min(hip_depths), max(hip_depths)],
        'window_builder_root_depth_range': [min(max(-.35, min(.35, -z * 1.5)) for z in hip_depths),
                                            max(max(-.35, min(.35, -z * 1.5)) for z in hip_depths)],
        'limits': ['No camera unprojection or world-space accuracy test',
                   'Aspect factor is a coordinate-scale fact, not a validated retargeting fix',
                   'Current remote extractor is not an immutable record of the original run'],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
