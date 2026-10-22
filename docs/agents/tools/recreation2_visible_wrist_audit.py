"""Non-blinded agent visual region review, not human ground truth."""
import itertools
import json
from pathlib import Path
import cv2
import numpy as np
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT

OUT = ROOT / 'docs/agents/raw/2026-10-22-visible-wrist-audit'
# Frozen from viewing raw image coordinate grids, before numeric scoring.
REGIONS = {
    195: {'image_lower_left_wrist': [550, 407, 580, 437], 'image_upper_right_wrist': [783, 294, 811, 317]},
    197: {'image_lower_left_wrist': [555, 397, 585, 425], 'image_upper_right_wrist': [758, 248, 789, 279]},
    203: {'image_lower_left_wrist': [551, 389, 579, 419], 'image_upper_right_wrist': [700, 225, 735, 263]},
    205: {'image_lower_left_wrist': [553, 392, 580, 420], 'image_upper_right_wrist': [695, 220, 730, 253]},
}


def distance(point, box, padding=0):
    p = np.array(point, dtype=float)
    lo = np.array(box[:2])-padding
    hi = np.array(box[2:])+padding
    return float(np.linalg.norm(np.maximum(np.maximum(lo-p, p-hi), 0)))


def assignments(points, regions, padding):
    result = []
    for order in itertools.permutations(regions):
        ds = {name: distance(points[name], regions[region], padding) for name, region in zip(points, order)}
        result.append({'assignment': dict(zip(points, order)), 'per_wrist_region_distance_px': ds,
                       'mean_region_distance_px': float(np.mean(list(ds.values())))})
    return {'all_bijections': result, 'best_mean_region_distance_px': min(x['mean_region_distance_px'] for x in result)}


def main():
    assert distance([5,5], [0,0,10,10]) == 0
    assert distance([10,5], [0,0,10,10]) == 0
    assert distance([13,14], [0,0,10,10]) == 5
    assert distance([13,14], [0,0,10,10], 4) == 0
    test = {'a': [5,5], 'b': [25,25]}
    regions = {'one': [0,0,10,10], 'two': [20,20,30,30]}
    assert assignments(test, regions, 0)['best_mean_region_distance_px'] == 0
    assert assignments(dict(reversed(list(test.items()))), regions, 0)['best_mean_region_distance_px'] == 0
    source_path = ROOT / 'docs/agents/raw/2026-10-22-turn-continuity/report.json'
    source = json.loads(source_path.read_text())
    track_path = ROOT / 'docs/agents/raw/2026-10-21-world-companion-projection/world-pts-timestamps.json'
    track = {r['frame']: r for r in json.loads(track_path.read_text())['frames']}
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for event, regions in REGIONS.items():
        observation = next(r for r in source['frames'] if r['source_frame'] == event)
        image_path = source_path.parent / 'frames' / f'source-{event-184:02d}.png'
        assert base.digest(image_path) == observation['source_image_sha256']
        mp = {n: (np.array(track[event]['target_landmarks'][base.JOINTS[n]][:2])*[1394,792]).tolist()
              for n in ['left_wrist', 'right_wrist']}
        rtm = {n: observation['roi_variants']['1.0']['joint_pixels'][n] for n in mp}
        row = {'source_frame': event, 'source_pts_s': observation['source_pts_s'],
               'source_image_sha256': base.digest(image_path), 'visual_regions_xyxy_px': regions, 'models': {}}
        boxes = list(regions.values())
        separation = np.maximum(np.maximum(np.array(boxes[0][:2])-boxes[1][2:],
                                           np.array(boxes[1][:2])-boxes[0][2:]), 0)
        row['visual_regions_min_separation_px'] = float(np.linalg.norm(separation))
        for label, points in [('mediapipe', mp), ('rtmpose', rtm)]:
            row['models'][label] = {'wrist_pixels': points,
                'inter_wrist_distance_px': float(np.linalg.norm(np.array(points['left_wrist'])-points['right_wrist'])), 'region_padding':
                {str(p): assignments(points, regions, p) for p in [0,5,10]}}
        canvas = cv2.imread(str(image_path))
        for name, box in regions.items():
            cv2.rectangle(canvas, tuple(box[:2]), tuple(box[2:]), (255,255,255), 2)
            cv2.putText(canvas, name, (box[0], box[1]-6), 0, .4, (255,255,255), 1)
        # Include both exact original-image coordinates and expanded visual crop.
        cv2.putText(canvas, f'{event}: agent visual regions; NON-BLIND, not ground truth', (10,30), 0, .65, (255,255,255), 1)
        cv2.imwrite(str(OUT / f'regions-{event}.jpg'), canvas)
        rows.append(row)
    report = {'schema': 'recreation2-visible-wrist-audit.v1', 'frames': rows,
              'reviewer': 'Codex agent visual estimates, saw model overlays earlier; NOT blind or human-labelled truth',
              'definition': 'Distance to permissive rectangle, best of both bijections; not true joint error',
              'input_sha256': {str(p): base.digest(p) for p in [source_path, track_path]},
              'tool_sha256': base.digest(__file__), 'verification': 'distance and bijection checks passed; four image hashes matched',
              'limits': ['Four selected frames, eight wrists; no statistical confidence',
                         'No anatomical left/right truth assigned; no 3D/K/contact validation',
                         'Raw RGB viewing estimates and 5/10px padding are sensitivity probes only',
                         'No model preference or trajectory changes applied']}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2)+'\n')
    for r in rows:
        print(r['source_frame'], {m: {p: round(s['best_mean_region_distance_px'],2)
              for p,s in data['region_padding'].items()} for m,data in r['models'].items()})


if __name__ == '__main__':
    main()
