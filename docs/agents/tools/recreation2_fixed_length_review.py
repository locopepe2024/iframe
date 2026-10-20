"""Source-aligned range audit and six-event overlays for the isolated experiment."""
import argparse
import json
import math
import statistics
from pathlib import Path
from PIL import Image, ImageDraw

p = argparse.ArgumentParser()
for name in ('report', 'track', 'source-images', 'out'):
    p.add_argument('--' + name, required=True)
a = p.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
r = json.loads(Path(a.report).read_text())
t = json.loads(Path(a.track).read_text())
src = {f['source_frame']: f['semantic_joints'] for f in t['frames']}
baseline_label = 'original' if 'original' in r['cases'] else 'baseline'
rows = r['cases'][baseline_label]['source_observations']
audit = {}
for joint in rows[0]['per_joint_px']:
    source = [[src[row['source_frame']][joint][i]*v for i, v in enumerate((640, 360))] for row in rows]
    audit[joint] = {'source_range_xy_px': [max(v[i] for v in source)-min(v[i] for v in source) for i in (0, 1)]}
    for label, c in r['cases'].items():
        pixels = [c['output'][row['new_bundle_frame']-1]['pixels'][joint] for row in rows]
        audit[joint][label+'_range_xy_px'] = [max(v[i] for v in pixels)-min(v[i] for v in pixels) for i in (0, 1)]
(out/'motion-range-audit.json').write_text(json.dumps(audit, indent=2)+'\n')
if 'pelvis_diagnostics' in rows[0]:
    regions = {}
    for label, c in r['cases'].items():
        regions[label] = []
        for ob in c['source_observations']:
            sf = ob['source_frame']
            pix = c['output'][ob['new_bundle_frame']-1]['pixels']
            actual = [pix['right_hip'][i]-pix['left_hip'][i] for i in (0, 1)]
            expected = [(src[sf]['right_hip'][i]-src[sf]['left_hip'][i])*s
                        for i, s in enumerate((640, 360))]
            cross = actual[0]*expected[1]-actual[1]*expected[0]
            dot = sum(x*y for x, y in zip(actual, expected))
            regions[label].append({
                'source_frame': sf, 'mean_px': ob['mean_px'],
                'upper6_mean_px': statistics.mean(e for k, e in ob['per_joint_px'].items()
                                                  if k.endswith(('shoulder', 'elbow', 'wrist'))),
                'lower6_mean_px': statistics.mean(e for k, e in ob['per_joint_px'].items()
                                                  if k.endswith(('hip', 'knee', 'ankle'))),
                'hip_screen_direction_error_deg': math.degrees(math.atan2(abs(cross), dot)),
                'hip_screen_length_ratio': math.hypot(*actual)/math.hypot(*expected),
                'diagnostics': ob['pelvis_diagnostics']})
    (out/'body-region-audit.json').write_text(json.dumps(regions, indent=2)+'\n')
events = (1, 17, 23, 29, 41, 55)
canvas = Image.new('RGB', (640*len(r['cases']), 388*len(events)), '#151515')
pairs = [(f'{s}_{b}', f'{s}_{e}') for s in ('left', 'right')
         for b, e in [('shoulder', 'elbow'), ('elbow', 'wrist'), ('hip', 'knee'), ('knee', 'ankle'), ('shoulder', 'hip')]]
pairs += [('left_hip', 'right_hip'), ('left_shoulder', 'right_shoulder')]
for row_index, sf in enumerate(events):
    source = Image.open(Path(a.source_images)/f'source-{sf:03d}.png').convert('RGB').resize((640, 360))
    source_pixels = {k: (v[0]*640, v[1]*360) for k, v in src[sf].items()}
    for col, (label, c) in enumerate(r['cases'].items()):
        ob = next(v for v in c['source_observations'] if v['source_frame'] == sf)
        actual = c['output'][ob['new_bundle_frame']-1]['pixels']
        tile = source.copy()
        draw = ImageDraw.Draw(tile)
        for points, color, width in ((source_pixels, '#00ff80', 2), (actual, '#ff40e0', 2)):
            for start, end in pairs:
                draw.line([tuple(points[start]), tuple(points[end])], fill=color, width=width)
        canvas.paste(tile, (col*640, row_index*388+28))
        ImageDraw.Draw(canvas).text((col*640+8, row_index*388+8),
                                   f'source {sf} | {label} | mean {ob["mean_px"]:.2f}px | green=source magenta=rig', fill='white')
canvas.save(out/'source-overlays.jpg', quality=90)
print('FIXED_LENGTH_REVIEW_COMPLETE')
