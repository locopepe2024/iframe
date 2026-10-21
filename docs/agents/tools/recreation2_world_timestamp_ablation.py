"""Compare average-FPS and source-PTS extraction with all other inputs fixed."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

AVERAGE_FPS_EXTRACTOR_SHA256 = 'aead79a0e1726428264221306893e6de4d0ced7f9697a8f20aed7e99fa6e2765'
SOURCE_PTS_EXTRACTOR_SHA256 = '6af9afeee05d2f7664a7c2511101d3a3d8f7458494f1a17abd5dc7a3e8850315'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def max_abs(rows_a, rows_b):
    if rows_a is None or rows_b is None:
        return None
    return float(np.max(np.abs(np.asarray(rows_a, dtype=float) -
                               np.asarray(rows_b, dtype=float))))


def main():
    ap = argparse.ArgumentParser()
    for name in ('baseline', 'pts', 'pts_map', 'out'):
        ap.add_argument('--' + name.replace('_', '-'), required=True)
    args = ap.parse_args()
    baseline_path, pts_path, map_path = map(Path, (args.baseline, args.pts, args.pts_map))
    baseline = json.loads(baseline_path.read_text())
    actual = json.loads(pts_path.read_text())
    pts_map = json.loads(map_path.read_text())
    old = {f['frame']: f for f in baseline['frames']}
    new = {f['frame']: f for f in actual['frames']}
    pts = {int(f['track_frame']): f for f in pts_map['sampled_track_frames']}
    assert set(old) == set(new) == set(pts)
    rows = []
    for frame in sorted(old):
        a, b, p = old[frame], new[frame], pts[frame]
        image_delta = max_abs(a['target_landmarks'], b['target_landmarks'])
        world_delta = max_abs(a['target_world_landmarks'], b['target_world_landmarks'])
        row = {
            'track_frame': frame, 'source_pts_s': p['source_pts_s'],
            'avg_fps_timestamp_s': a['timestamp_seconds'],
            'pts_timestamp_s': b['timestamp_seconds'],
            'target_pose_index_equal': a['target_pose_index'] == b['target_pose_index'],
            'selection_status_equal': a['selection_status'] == b['selection_status'],
            'subject_count_equal': a['subject_count'] == b['subject_count'],
            'image_landmark_max_abs_delta': image_delta,
            'world_landmark_max_abs_delta': world_delta,
            'world_missing_both': a['target_world_landmarks'] is None and b['target_world_landmarks'] is None,
        }
        assert row['target_pose_index_equal'] and row['selection_status_equal'] and row['subject_count_equal']
        assert image_delta in (0., None)
        assert world_delta in (0., None)
        assert abs(b['timestamp_seconds'] - p['source_pts_s']) < 1e-6
        rows.append(row)
    avg_errors = [abs(r['avg_fps_timestamp_s'] - r['source_pts_s']) for r in rows]
    event = {str(n): next(r for r in rows if r['track_frame'] == n)
             for n in (1, 17, 23, 29, 55, 57, 59, 61)}
    report = {
        'schema': 'recreation2-world-timestamp-ablation.v1',
        'baseline_sha256': digest(baseline_path), 'pts_run_sha256': digest(pts_path),
        'pts_map_sha256': digest(map_path),
        'average_fps_extractor_sha256': AVERAGE_FPS_EXTRACTOR_SHA256,
        'source_pts_extractor_sha256': SOURCE_PTS_EXTRACTOR_SHA256,
        'frame_count': len(rows),
        'pose_selection_exact_frames': sum(r['target_pose_index_equal'] and r['selection_status_equal'] for r in rows),
        'candidate_count_exact_frames': sum(r['subject_count_equal'] for r in rows),
        'image_landmark_state_exact_frames': sum(
            (r['image_landmark_max_abs_delta'] == 0) or
            (r['image_landmark_max_abs_delta'] is None and
             old[r['track_frame']]['target_landmarks'] is None and
             new[r['track_frame']]['target_landmarks'] is None)
            for r in rows),
        'image_landmark_value_exact_available_frames': sum(r['image_landmark_max_abs_delta'] == 0 for r in rows),
        'world_available_frames': sum(not r['world_missing_both'] for r in rows),
        'world_xyz_exact_available_frames': sum(r['world_landmark_max_abs_delta'] == 0 for r in rows if r['world_landmark_max_abs_delta'] is not None),
        'average_fps_timestamp_abs_error_s': {
            'median': float(np.median(avg_errors)), 'p90': float(np.percentile(avg_errors, 90)),
            'max': float(np.max(avg_errors)),
        },
        'event_frames': event,
        'rows': rows,
        'limits': ['Same decoded frame selection and model settings; this tests only VIDEO timestamp input', 'Exact output equality in this run does not validate world landmarks as 3D truth or camera calibration'],
    }
    Path(args.out).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('frame_count', 'pose_selection_exact_frames', 'image_landmark_state_exact_frames', 'image_landmark_value_exact_available_frames', 'world_available_frames', 'world_xyz_exact_available_frames', 'average_fps_timestamp_abs_error_s')}))


if __name__ == '__main__':
    main()
