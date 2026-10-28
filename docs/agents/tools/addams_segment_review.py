"""Build/import a sparse event review. Decisions never propagate to unreviewed frames."""
import argparse
import base64
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parents[3] / 'docs/agents/raw/2026-10-28-motion-asset-package'
OUT = BASE / 'addams-segment-review-v1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    queue = json.loads((OUT / 'review-queue.json').read_text())
    observations = json.loads(gzip.decompress((OUT / 'observations.json.gz').read_bytes()))
    selected = sorted({t['review_frame'] for t in queue['tasks']})
    images = OUT / 'event-frames'
    images.mkdir(exist_ok=True)
    source = json.loads((BASE / 'addams-source-clip.json').read_text())['path']
    expr = '+'.join(f'eq(n\\,{sf-1})' for sf in selected)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
                    '-vf', f'select={expr},scale=960:520', '-fps_mode', 'vfr', str(images / 'event-%03d.jpg')], check=True)
    tasks = []
    for i, sf in enumerate(selected):
        row = observations[sf-1]
        image = images / f'event-{i+1:03}.jpg'
        w, h = row['image_size']
        tasks.append({'source_frame': sf, 'pts_s': row['pts_s'], 'segment_id': row['segment_id'],
                      'intervals': [t for t in queue['tasks'] if t['review_frame'] == sf],
                      'image_sha256': digest(image), 'image_path': str(image.relative_to(OUT)),
                      'candidates': [{'id': j, 'box': [v / (w if k % 2 == 0 else h) for k, v in enumerate(p['box_xyxy'])]}
                                     for j, p in enumerate(row['independent_people'])],
                      'preview': 'data:image/jpeg;base64,' + base64.b64encode(image.read_bytes()).decode()})
    package = {'schema': 'addams-event-review-tasks.v1', 'source_sha256': queue['source_sha256'],
               'queue_sha256': digest(OUT / 'review-queue.json'), 'tasks': tasks}
    clean = {**package, 'tasks': [{k: v for k, v in t.items() if k != 'preview'} for t in tasks]}
    (OUT / 'event-tasks.json').write_text(json.dumps(clean, ensure_ascii=False, indent=2) + '\n')
    package['tasks_sha256'] = digest(OUT / 'event-tasks.json')
    template = Path(__file__).with_suffix('.html').read_text()
    (OUT / 'review.html').write_text(template.replace('/*PACKAGE*/{}', json.dumps(package, ensure_ascii=False)))
    print(json.dumps({'tasks': len(tasks), 'intervals': len(queue['tasks']), 'html': str(OUT / 'review.html')}))


def normalize(export, package):
    for key in ['source_sha256', 'queue_sha256']:
        if export.get(key) != package[key]:
            raise ValueError('Mismatched ' + key)
    if export.get('schema') != 'addams-event-review.v1':
        raise ValueError('Unsupported export schema')
    expected = {t['source_frame']: t for t in package['tasks']}
    reviewed = []
    seen = set()
    for row in export['reviews']:
        sf = row['source_frame']
        if sf not in expected or sf in seen:
            raise ValueError('Unknown or duplicate frame')
        seen.add(sf)
        task = expected[sf]
        if row.get('image_sha256') != task['image_sha256']:
            raise ValueError('Mismatched image')
        identity = row.get('identity')
        valid = ['absent', 'uncertain', 'visible_undetected'] + [str(c['id']) for c in task['candidates']]
        if identity not in valid:
            raise ValueError('Invalid candidate identity')
        if row.get('contact') not in ['left', 'right', 'both', 'airborne', 'other', 'uncertain']:
            raise ValueError('Invalid contact')
        if identity == 'absent' and row['contact'] != 'uncertain':
            raise ValueError('Absent target cannot establish contact')
        reviewed.append({**row, 'pts_s': task['pts_s'], 'segment_id': task['segment_id']})
    return {'schema': 'addams-event-reviewed.v1', 'source_sha256': package['source_sha256'],
            'reviewed_count': len(reviewed), 'pending_count': len(expected) - len(reviewed),
            'scope': 'Explicit representative frames only; no interval propagation or 3D acceptance.',
            'frames': sorted(reviewed, key=lambda r: r['source_frame'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['build', 'import'])
    parser.add_argument('--export', type=Path)
    args = parser.parse_args()
    if args.command == 'build':
        build()
    else:
        if not args.export:
            parser.error('--export required')
        export = json.loads(args.export.read_text())
        if export.get('tasks_sha256') != digest(OUT / 'event-tasks.json'):
            raise ValueError('Mismatched task version')
        package = json.loads((OUT / 'event-tasks.json').read_text())
        if package['queue_sha256'] != digest(OUT / 'review-queue.json'):
            raise ValueError('Stale queue')
        for t in package['tasks']:
            if digest(OUT / t['image_path']) != t['image_sha256']:
                raise ValueError('Changed review image')
        result = normalize(export, package)
        result['export_sha256'] = digest(args.export)
        (OUT / 'event-reviewed.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({k: result[k] for k in ['reviewed_count', 'pending_count']}))


if __name__ == '__main__':
    main()
