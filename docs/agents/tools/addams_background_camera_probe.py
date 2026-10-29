"""Independent 2D background-motion audit; no 3D camera claim or pose edits."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

BASE = Path('/tmp/addams-pose')
OUT = BASE / 'gvhmr-native-v1'
source = BASE / 'source.mp4'
mapping = json.loads((OUT / 'frame-map.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest() == mapping['source_sha256']
cv2.setRNGSeed(29)
capture = cv2.VideoCapture(str(source))
assert abs(capture.get(cv2.CAP_PROP_FPS) - 25) < 0.01
images = {}
for sf in range(1, 66):
    ok, image = capture.read()
    assert ok
    if sf >= 37:
        images[sf] = cv2.resize(image, (960, 520), interpolation=cv2.INTER_AREA)
capture.release()
regions = {'left_structure': (0, .60, .20, .92),
           'right_structure': (.88, .60, 1, .92),
           'left_ground': (0, .92, .25, 1),
           'right_ground': (.86, .92, 1, 1)}
mask = np.zeros((520, 960), np.uint8)
region_map = np.full((520, 960), -1, np.int32)
for j, box in enumerate(regions.values()):
    x0, y0, x1, y1 = (int(v * dim) for v, dim in zip(box, (960, 520, 960, 520)))
    mask[y0:y1, x0:x1] = 255
    region_map[y0:y1, x0:x1] = j
gray = {sf: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) for sf, im in images.items()}

def warp(matrix, points):
    return cv2.perspectiveTransform(points.reshape(-1, 1, 2).astype(np.float64), matrix).reshape(-1, 2)

def stats(values):
    return {'count': len(values), 'median_px': float(np.median(values)),
            'p95_px': float(np.percentile(values, 95)), 'max_px': float(np.max(values))}

def compare(a, b, held):
    train = ~held
    if train.sum() < 12 or held.sum() < 8:
        return {'status': 'insufficient_train_or_holdout', 'train_count': int(train.sum()),
                'holdout_count': int(held.sum())}
    models = {'identity': np.eye(3)}
    translation = np.eye(3)
    translation[:2, 2] = np.median(b[train] - a[train], axis=0)
    models['translation'] = translation
    affine, _ = cv2.estimateAffinePartial2D(a[train], b[train], method=cv2.RANSAC,
                                          ransacReprojThreshold=1., maxIters=3000)
    if affine is not None:
        models['similarity'] = np.vstack([affine, (0, 0, 1)])
    homography, _ = cv2.findHomography(a[train], b[train], cv2.RANSAC, 1.)
    if homography is not None and np.isfinite(homography).all():
        models['homography'] = homography
    return {'status': 'measured', 'train_count': int(train.sum()), 'holdout_count': int(held.sum()),
            'median_observed_delta_px': np.median(b - a, axis=0).tolist(),
            'models': {name: {'matrix': mat.tolist(),
                             'holdout': stats(np.linalg.norm(warp(mat, a[held]) - b[held], axis=1)),
                             'train': stats(np.linalg.norm(warp(mat, a[train]) - b[train], axis=1))}
                       for name, mat in models.items()}}

lk = dict(winSize=(31, 31), maxLevel=3,
          criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, .001))
experiments = []
overlay = {}
for anchor in (37, 49):
    points = cv2.goodFeaturesToTrack(gray[anchor], maxCorners=400, qualityLevel=.015,
                                    minDistance=7, mask=mask, blockSize=7)
    assert points is not None
    initial = points.reshape(-1, 2)
    labels = region_map[initial[:, 1].astype(int), initial[:, 0].astype(int)]
    # Spatial groups chosen before tracking/fitting; held points never enter RANSAC.
    held = ((initial[:, 0] // 48 + 2 * (initial[:, 1] // 48)).astype(int) % 4) == 0
    ids = np.arange(len(initial))
    previous = anchor
    rows = []
    for sf in range(anchor + 1, 66):
        previous_points = points.copy()
        tracked, valid, error = cv2.calcOpticalFlowPyrLK(gray[previous], gray[sf], points, None, **lk)
        back, reverse_valid, _ = cv2.calcOpticalFlowPyrLK(gray[sf], gray[previous], tracked, None, **lk)
        q = tracked.reshape(-1, 2)
        fb = np.linalg.norm(back.reshape(-1, 2) - points.reshape(-1, 2), axis=1)
        good = (valid.ravel() != 0) & (reverse_valid.ravel() != 0) & (fb <= .5) & (error.ravel() <= 30)
        good &= (q[:, 0] >= 0) & (q[:, 0] < 960) & (q[:, 1] >= 0) & (q[:, 1] < 520)
        inside = np.zeros(len(q), bool)
        for i in np.where(good)[0]:
            inside[i] = bool(mask[int(q[i, 1]), int(q[i, 0])])
        good &= inside
        # Independent inverse to anchor rejects accumulated drift; no model inlier filter.
        direct_back, direct_valid, _ = cv2.calcOpticalFlowPyrLK(gray[sf], gray[anchor], tracked, None, **lk)
        good &= (direct_valid.ravel() != 0) & (np.linalg.norm(direct_back.reshape(-1, 2) - initial[ids], axis=1) <= .75)
        ids = ids[good]
        points = tracked[good]
        result = compare(initial[ids], points.reshape(-1, 2), held[ids])
        # Measure actual adjacent tracked displacement, distinct from anchor displacement.
        old_points = previous_points.reshape(-1, 2)[good]
        result['adjacent_identity_displacement'] = stats(np.linalg.norm(points.reshape(-1, 2) - old_points, axis=1))
        result.update({'source_frame': sf, 'previous_source_frame': previous,
                       'source_pts_s': (sf - 1) / 25,
                       'region_counts': {name: int(np.sum(labels[ids] == j)) for j, name in enumerate(regions)},
                       'track_count': len(ids)})
        rows.append(result)
        if anchor == 49 and sf in (52, 53):
            overlay[sf] = (initial[ids].copy(), points.reshape(-1, 2).copy(), held[ids].copy())
        previous = sf
        if len(ids) < 20:
            break
    experiments.append({'anchor_source_frame': anchor, 'initial_track_count': len(initial), 'rows': rows})

tiles = []
for sf in (49, 52, 53):
    image = images[sf].copy()
    tint = image.copy()
    tint[mask != 0] = (50, 160, 50)
    image = cv2.addWeighted(image, .75, tint, .25, 0)
    for name, box in regions.items():
        x0, y0, x1, y1 = (int(v * dim) for v, dim in zip(box, (960, 520, 960, 520)))
        cv2.rectangle(image, (x0, y0), (x1 - 1, y1 - 1), (0, 220, 120), 1)
    if sf in overlay:
        a, b, test = overlay[sf]
        for p, q, hold in zip(a, b, test):
            color = (230, 80, 230) if hold else (0, 240, 240)
            cv2.circle(image, tuple(np.rint(q).astype(int)), 2, color, -1)
            cv2.line(image, tuple(np.rint(p).astype(int)), tuple(np.rint(q).astype(int)), color, 1)
    cv2.putText(image, f'Source {sf} | green mask; magenta holdout; yellow train', (12, 24),
                cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 1)
    tiles.append(image)
cv2.imwrite(str(OUT / 'background-camera-contact.png'), np.vstack(tiles))
report = {'schema': 'addams-background-camera-probe.v1', 'source_sha256': mapping['source_sha256'],
          'source_fps': 25, 'size': [960, 520], 'source_range': [37, 65],
          'regions_normalized': regions, 'experiments': experiments,
          'limits': ['Hand-selected background rectangles require visual mask review.',
                     '2D background consistency cannot establish depth, gravity, focal or physical camera translation.',
                     'Spatial holdout tracks exclude training but share detector/flow; not independent ground truth.',
                     'Blur, animation deformation and moving shadows may bias tracking.',
                     'No 3D camera solve or production camera change has occurred.']}
(OUT / 'background-camera-probe.json').write_text(json.dumps(report, indent=2) + '\n')
for experiment in experiments:
    for row in experiment['rows']:
        if row['source_frame'] in (49, 52, 53, 65):
            print(experiment['anchor_source_frame'], row['source_frame'], row['track_count'],
                  row.get('holdout_count'), {k: v['holdout'] for k, v in row.get('models', {}).items()}, flush=True)
