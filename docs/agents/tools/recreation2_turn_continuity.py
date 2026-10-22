"""Contiguous 2D observations; label swaps are scored, never applied."""
import argparse
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np
from rtmlib import RTMPose
import recreation2_independent_pose as prior

ROOT = prior.ROOT
OUT = ROOT / 'docs/agents/raw/2026-10-22-turn-continuity'


def swap(points):
    return {n: points[('right_' + n[5:]) if n.startswith('left_') else ('left_' + n[6:])]
            for n in prior.COCO}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True)
    args = parser.parse_args()
    video = Path('/private/tmp/recreation2-clip-exact10.mp4')
    previous_path = ROOT / 'docs/agents/raw/2026-10-22-independent-pose/report.json'
    previous = json.loads(previous_path.read_text())
    assert prior.base.digest(video) == previous['input_sha256'][str(video)]
    track_path = ROOT / 'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json'
    raw = {r['frame']: r for r in json.loads(track_path.read_text())['frames']}
    anchors = sorted(i for i, r in raw.items() if r.get('target_bbox') is not None)
    pts = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(video)]))['frames']
    times = [float(r['best_effort_timestamp_time']) for r in pts]
    assert all(b > a for a, b in zip(times, times[1:]))
    OUT.mkdir(parents=True, exist_ok=True)
    frames = OUT / 'frames'
    frames.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(video), '-vf',
                    'select=between(n\\,184\\,212)', '-vsync', '0', str(frames / 'source-%02d.png')], check=True)
    model = RTMPose(args.weights, model_input_size=(192, 256), backend='onnxruntime', device='cpu', to_openpose=False)
    rows, tiles = [], []
    previous_xy = None
    for order, event in enumerate(range(185, 214), 1):
        lo = max(i for i in anchors if i <= event)
        hi = min(i for i in anchors if i >= event)
        weight = 0 if lo == hi else (event - lo) / (hi - lo)
        box = (1-weight)*np.array(raw[lo]['target_bbox']) + weight*np.array(raw[hi]['target_bbox'])
        path = frames / f'source-{order:02d}.png'
        img = cv2.imread(str(path))
        assert img.shape == (792, 1394, 3)
        row = {'source_frame': event, 'source_pts_s': times[event-1], 'source_image_sha256': prior.base.digest(path),
               'roi_anchor_frames': [lo, hi], 'roi_interpolated': lo != hi, 'roi_variants': {}}
        for factor in (.9, 1., 1.1):
            points, scores = model(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), bboxes=[prior.adjusted_box(box, factor).tolist()])
            assert points.shape == (1, 17, 2) and np.isfinite(points).all() and np.isfinite(scores).all()
            xy = {n: points[0, index].astype(float) for n, index in prior.COCO.items()}
            item = {'joint_pixels': {n: p.tolist() for n, p in xy.items()},
                    'joint_scores': {n: float(scores[0, index]) for n, index in prior.COCO.items()}}
            if event in raw and raw[event].get('target_landmarks') is not None:
                mp = {n: np.array(raw[event]['target_landmarks'][prior.base.JOINTS[n]][:2])*[1394, 792] for n in prior.COCO}
                item['mp_same_labels'] = prior.compare(xy, mp, list(xy))
                item['mp_swapped_labels_exploratory'] = prior.compare(swap(xy), mp, list(xy))
            row['roi_variants'][str(factor)] = item
        center = {n: np.array(p) for n, p in row['roi_variants']['1.0']['joint_pixels'].items()}
        for factor in ('0.9', '1.1'):
            alt = {n: np.array(p) for n, p in row['roi_variants'][factor]['joint_pixels'].items()}
            row['roi_variants'][factor]['change_from_central_roi'] = prior.compare(alt, center, list(center))
        if previous_xy is not None:
            row['previous_frame_same_labels'] = prior.compare(center, previous_xy, list(center))
            row['previous_frame_swapped_labels_exploratory'] = prior.compare(swap(center), previous_xy, list(center))
        previous_xy = center
        canvas = img.copy()
        for n, p in center.items():
            q = tuple(np.rint(p).astype(int))
            color = (40, 240, 40) if n.startswith('left_') else (255, 160, 60)
            cv2.circle(canvas, q, 4, color, -1)
            cv2.putText(canvas, n, q, cv2.FONT_HERSHEY_SIMPLEX, .3, color, 1)
        b = prior.adjusted_box(box, 1.3).astype(int)
        b[::2] = np.clip(b[::2], 0, 1394)
        b[1::2] = np.clip(b[1::2], 0, 792)
        crop = canvas[b[1]:b[3], b[0]:b[2]]
        cv2.imwrite(str(OUT / f'subject-{event:03d}.jpg'), crop)
        scale = min(240/crop.shape[1], 290/crop.shape[0])
        resized = cv2.resize(crop, None, fx=scale, fy=scale)
        tile = np.zeros((320, 240, 3), np.uint8)
        tile[30:30+resized.shape[0], :resized.shape[1]] = resized
        cv2.putText(tile, f'{event} | ROI interp={lo != hi}', (4, 20), cv2.FONT_HERSHEY_SIMPLEX, .45, (255,255,255), 1)
        tiles.append(tile)
        rows.append(row)
    reference = next(r for r in previous['frames'] if r['source_frame'] == 197)['roi_variants']['1.0']['joint_pixels']
    current = next(r for r in rows if r['source_frame'] == 197)['roi_variants']['1.0']['joint_pixels']
    gap = max(np.max(np.abs(np.array(current[n])-reference[n])) for n in reference)
    assert gap < 1e-4 and len(rows) == 29
    tiles += [np.zeros_like(tiles[0])] * (30-len(tiles))
    sheet = np.vstack([np.hstack(tiles[i:i+6]) for i in range(0,30,6)])
    cv2.imwrite(str(OUT / 'contact-sheet.jpg'), sheet)
    paired = [r for r in rows if 'mp_same_labels' in r['roi_variants']['1.0']]
    matched_intervals = []
    for first, second in zip(paired, paired[1:]):
        mp = [{n: np.array(raw[r['source_frame']]['target_landmarks'][prior.base.JOINTS[n]][:2])*[1394, 792]
               for n in prior.COCO} for r in (first, second)]
        rtm = [{n: np.array(p) for n, p in r['roi_variants']['1.0']['joint_pixels'].items()}
               for r in (first, second)]
        matched_intervals.append({'source_frames': [first['source_frame'], second['source_frame']],
            'delta_pts_s': second['source_pts_s']-first['source_pts_s'],
            'mediapipe_displacement': prior.compare(mp[1], mp[0], list(mp[0])),
            'rtmpose_displacement': prior.compare(rtm[1], rtm[0], list(rtm[0]))})
    report = {'schema': 'recreation2-turn-continuity.v1', 'frames': rows,
              'matched_observation_intervals': matched_intervals,
              'video_sha256': prior.base.digest(video), 'track_sha256': prior.base.digest(track_path),
              'onnx_sha256': prior.base.digest(args.weights), 'tool_sha256': prior.base.digest(__file__),
              'prior_tool_sha256': prior.base.digest(prior.__file__),
              'verification': {'frame197_repeat_max_difference_px': float(gap), 'frame_count': len(rows), 'strictly_increasing_pts': True},
              'limits': ['MP anchor ROI linearly interpolated by frame index; no joint interpolation',
                         'Independent weights, not independent ROI or ground truth', 'No K fitting, 3D inference, contact validation or production changes',
                         'Raw scores retained; no automatic label swap or score-based selection']}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report['verification']))


if __name__ == '__main__':
    main()
