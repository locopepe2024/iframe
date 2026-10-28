"""Owner-scoped source-frame annotations, separate from timeline revision."""
import json
import math
import time
from uuid import uuid4
from pathlib import Path

from fastapi import HTTPException
from PIL import Image
from .analysis import fingerprint, run, INPUT_OPTIONS

JOINTS = {'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'}


def current(record, analysis_id):
    if record.get('analysis_id') != analysis_id or not record.get('analysis'):
        raise HTTPException(409, 'Analysis changed; refresh the project')


def reviews(service, project_id):
    record = service.get(project_id)
    return {'analysis_id': record.get('analysis_id'), 'frames': sorted(
        [r for r in record.get('pose_reviews', {}).values() if r['analysis_id'] == record.get('analysis_id')],
        key=lambda r: r['pts'])}


def prepare(service, project_id, analysis_id, pts):
    record = service.get(project_id)
    current(record, analysis_id)
    analysis = record['analysis']
    if type(pts) is not int or pts not in analysis['frame_pts']:
        raise HTTPException(422, 'Select an exact source-frame PTS')
    source = service._path(record['source_url'])
    if fingerprint(source) != record['source_fingerprint']:
        raise HTTPException(409, 'Source fingerprint changed')
    # Existing frames are stable media identities; never replace a reviewed image.
    with service.db() as db:
        rows = db.execute("SELECT media_id FROM media_records WHERE owner=? AND project_id=? AND kind='sample_frame'",
                          (service.user.owner_profile_id, project_id)).fetchall()
        for row in rows:
            media = service._media(db, row[0])
            meta = media['metadata']
            if meta.get('role') == 'pose_review' and meta.get('analysis_id') == analysis_id and meta.get('pts') == pts:
                return frame_record(service, db, service._get(db, project_id), media)
    dest = service.root / project_id / analysis_id / ('pose-' + uuid4().hex + '.jpg')
    dest.parent.mkdir(parents=True, exist_ok=True)
    index = analysis['frame_pts'].index(pts)
    run(['ffmpeg', '-nostdin', '-v', 'error', *INPUT_OPTIONS, '-threads', '1', '-i', str(source),
         '-map', '0:v:0', '-an', '-vf', f'select=eq(n\\,{index}),scale=960:960:force_original_aspect_ratio=decrease',
         '-frames:v', '1', '-threads', '1', str(dest)], timeout=30)
    with Image.open(dest) as im:
        width, height = im.size
    digest = fingerprint(dest)
    media_id = uuid4().hex
    stored = dest.relative_to(Path('output').resolve()).as_posix()
    meta = {'parent_media_id': record['source_media_id'], 'analysis_id': analysis_id, 'pts': pts,
            'time_base': analysis['time_base'], 'role': 'pose_review', 'width': width, 'height': height}
    with service.db() as db:
        record = service._get(db, project_id)
        current(record, analysis_id)
        # Another client may have prepared the same frame during FFmpeg extraction.
        for row in db.execute("SELECT media_id FROM media_records WHERE owner=? AND project_id=? AND kind='sample_frame'",
                              (service.user.owner_profile_id, project_id)).fetchall():
            item = service._media(db, row[0])
            if all(item['metadata'].get(k) == meta[k] for k in ['role', 'analysis_id', 'pts']):
                dest.unlink(missing_ok=True)
                return frame_record(service, db, record, item)
        db.execute('INSERT INTO media_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                   (media_id, service.user.owner_profile_id, project_id, 'sample_frame',
                    f"{record['title']} · pose · {pts}", stored, digest, json.dumps(meta), time.time()))
        return frame_record(service, db, record, service._media(db, media_id))


def frame_record(service, db, record, media):
    meta = media['metadata']
    current(record, meta['analysis_id'])
    if fingerprint(service._path(media['storage_path'])) != media['sha256']:
        raise HTTPException(409, 'Frame image changed')
    key = f"{meta['analysis_id']}:{meta['pts']}"
    saved = record.get('pose_reviews', {}).get(key)
    frame = {'analysis_id': meta['analysis_id'], 'pts': meta['pts'],
             'source_frame': record['analysis']['frame_pts'].index(meta['pts']) + 1,
             'time_base': record['analysis']['time_base'], 'source_checksum': record['source_fingerprint'],
             'media_id': media['media_id'], 'image_sha256': media['sha256'], 'image_url': media['storage_path'],
             'width': meta['width'], 'height': meta['height'], 'revision': 0,
             'joints': {}, 'contact': 'uncertain', 'status': 'draft', 'depth_order': 'uncertain'}
    if saved:
        frame.update(saved)
    return frame


def save(service, project_id, payload):
    with service.db() as db:
        record = service._get(db, project_id)
        current(record, payload['analysis_id'])
        media = service._media(db, payload['media_id'])
        meta = media['metadata']
        if media['project_id'] != project_id or meta.get('role') != 'pose_review' or meta.get('analysis_id') != payload['analysis_id'] or meta.get('pts') != payload['pts']:
            raise HTTPException(422, 'Frame does not belong to this project/analysis/PTS')
        frame = frame_record(service, db, record, media)
        if frame['image_sha256'] != payload['image_sha256'] or frame['revision'] != payload['revision']:
            raise HTTPException(409, 'Frame review changed; reload before saving')
        if payload.get('depth_order', 'uncertain') not in {'left_front', 'right_front', 'uncertain'}:
            raise HTTPException(422, 'Invalid leg depth order')
        joints = payload['joints']
        if set(joints) - JOINTS:
            raise HTTPException(422, 'Unknown joint')
        for joint in joints.values():
            xy = joint.get('xy')
            if joint.get('visibility') not in {'visible', 'occluded', 'uncertain'} or not isinstance(xy, list) or len(xy) != 2:
                raise HTTPException(422, 'Invalid joint review')
            if not all(type(x) in {int, float} and math.isfinite(x) for x in xy) or not (0 <= xy[0] <= frame['width'] and 0 <= xy[1] <= frame['height']):
                raise HTTPException(422, 'Joint is outside the source image')
        if payload['contact'] not in {'left', 'right', 'both', 'airborne', 'uncertain'} or payload['status'] not in {'draft', 'reviewed', 'not_evaluable'}:
            raise HTTPException(422, 'Invalid frame review state')
        if payload['status'] == 'reviewed' and set(joints) != JOINTS:
            raise HTTPException(422, 'Review all six joints; mark hidden joints occluded or uncertain')
        frame.update(joints=joints, depth_order=payload.get('depth_order', 'uncertain'), contact=payload['contact'], status=payload['status'], revision=frame['revision']+1,
                     reviewed_by=service.user.user_id, updated_at=time.time())
        record.setdefault('pose_reviews', {})[f"{frame['analysis_id']}:{frame['pts']}"] = frame
        # This write must not invalidate timeline/generation revisions.
        db.execute('UPDATE projects SET data=? WHERE id=? AND owner=?',
                   (json.dumps(record), project_id, service.user.owner_profile_id))
        return frame
