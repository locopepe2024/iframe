"""Resolve sampled tracker indices against per-frame PTS, not average FPS."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--track', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    raw = subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'frame=best_effort_timestamp_time',
        '-of', 'csv=p=0', args.video
    ], text=True)
    pts = [float(line.strip().rstrip(',')) for line in raw.splitlines() if line.strip()]
    track = json.loads(Path(args.track).read_text())
    rows = []
    for frame in track['frames']:
        index = int(frame['frame'])
        if index < 1 or index > len(pts):
            raise ValueError(f'track frame {index} outside decoded ffprobe frame count {len(pts)}')
        rows.append({'track_frame': index, 'source_pts_s': pts[index - 1],
                     'legacy_average_fps_timestamp_s': frame['timestamp_seconds'],
                     'pts_minus_legacy_timestamp_s': pts[index - 1] - frame['timestamp_seconds']})
    result = {
        'schema': 'recreation2-source-pts-index-map.v1',
        'video_sha256': sha(args.video), 'track_sha256': sha(args.track),
        'ffprobe_version': subprocess.check_output(['ffprobe', '-version'], text=True).splitlines()[0],
        'decoded_video_frame_count': len(pts), 'sampled_track_frames': rows,
        'limits': ['Map uses decoded 1-based frame index to ffprobe presentation timestamp', 'Does not imply pose detector used timestamp input to select the frame'],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, indent=2) + '\n')
    print('PTS_MAP_PASS', len(rows), 'samples from', len(pts), 'decoded frames')


if __name__ == '__main__':
    main()
