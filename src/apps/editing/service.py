"""Standalone timeline persistence. Source projects are strictly read-only."""
from contextlib import contextmanager
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import time
from uuid import uuid4

from fastapi import HTTPException
from ..comic_gen.models import AssemblyEditPlan
from ..comic_gen.assembly_compiler import compile_assembly
from ..media_registry import get_media, list_media, register_media
from ..recreation.service import RecreationService
from ..recreation.analysis import fingerprint, MAX_BYTES
from ..studio_access import resolve_studio_reference, studio_owner_dir
from ...utils.storage_config import media_root
from ...utils.system_check import get_ffmpeg_path, get_ffprobe_path


class EditingService:
    def __init__(self, user, output_root=None):
        self.user = user
        self.output_root = Path(output_root or media_root()).resolve()
        self.root = Path(studio_owner_dir(user.owner_profile_id, output_root=str(self.output_root))) / 'editing'
        self.root.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.output_root / 'editing.sqlite3', timeout=10)
        try:
            db.execute('CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS edit_versions (id TEXT, owner TEXT, revision INTEGER, data TEXT NOT NULL, PRIMARY KEY(id, owner, revision))')
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _get(self, db, edit_id):
        row = db.execute('SELECT data FROM edits WHERE id=? AND owner=?', (edit_id, self.user.owner_profile_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Editing project not found')
        return json.loads(row[0])

    def _persist(self, db, record):
        serialized = json.dumps(record)
        db.execute('UPDATE edits SET data=? WHERE id=? AND owner=?', (serialized, record['id'], self.user.owner_profile_id))
        db.execute('INSERT INTO edit_versions VALUES(?,?,?,?)', (record['id'], self.user.owner_profile_id, record['revision'], serialized))

    def list(self):
        with self.db() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT data FROM edits WHERE owner=? ORDER BY rowid DESC', (self.user.owner_profile_id,))]

    def get(self, edit_id):
        with self.db() as db:
            return self._get(db, edit_id)

    def create(self, title):
        record = dict(id=uuid4().hex, title=title, revision=0, plan=None, sources={}, output=None, created_at=time.time())
        with self.db() as db:
            db.execute('INSERT INTO edits VALUES(?,?,?)', (record['id'], self.user.owner_profile_id, json.dumps(record)))
            self._persist(db, record)
        return record

    def materials(self, query='', cursor=0):
        items = []
        for item in list_media(self.user.owner_profile_id, output_root=str(self.output_root)):
            if Path(item['storage_key']).suffix.lower() not in ('.mp4', '.mov', '.mkv', '.webm', '.wav', '.mp3', '.m4a', '.aac', '.ogg'):
                continue
            items.append(dict(id='core:'+item['media_id'], name=item['display_name'], url=item['storage_key'], origin='upload' if item['kind'] in ('editing_upload', 'temporary_input') else 'generated', sha256=item['sha256'], created_at=item['created_at']))
        recreation = RecreationService(self.user, output_root=str(self.output_root))
        for kind in ('source_video', 'generated_video', 'final_video'):
            offset = 0
            while True:
                page = recreation.search_media(kind=kind, limit=100, cursor=offset)
                for item in page['items']:
                    items.append(dict(id='recreation:'+item['media_id'], name=item['display_name'], url=item['storage_path'], origin='upload' if kind == 'source_video' else 'generated', sha256=item['sha256'], created_at=item['created_at']))
                if page['next_cursor'] is None:
                    break
                offset = page['next_cursor']
        items = sorted((item for item in items if query.casefold() in item['name'].casefold()), key=lambda item: (item['created_at'], item['id']), reverse=True)
        return dict(items=items[cursor:cursor+24], next_cursor=cursor+24 if len(items)>cursor+24 else None)

    def resolve(self, key):
        origin, _, media_id = key.partition(':')
        if origin == 'core':
            item = get_media(self.user.owner_profile_id, media_id, output_root=str(self.output_root))
            if not item:
                raise HTTPException(404, 'Material not found')
            stored, digest, name = item['storage_key'], item['sha256'], item['display_name']
        elif origin == 'recreation':
            item = RecreationService(self.user, output_root=str(self.output_root)).media(media_id)
            if item['kind'] not in ('source_video', 'generated_video', 'final_video'):
                raise HTTPException(422, 'Material is not video')
            stored, digest, name = item['storage_path'], item['sha256'], item['display_name']
        else:
            raise HTTPException(422, 'Unknown material namespace')
        try:
            relative = resolve_studio_reference(stored, self.user.owner_profile_id, output_root=str(self.output_root))
        except ValueError as exc:
            raise HTTPException(409, 'Material is missing or outside owner storage') from exc
        path = (self.output_root / relative).resolve()
        if not path.is_relative_to(self.output_root) or not path.is_file():
            raise HTTPException(409, 'Material is missing')
        actual = fingerprint(path)
        if digest and actual != digest:
            raise HTTPException(409, 'Material checksum changed')
        data = self._probe(path)
        kinds = {s['codec_type'] for s in data['streams']}
        durations = [float(s['duration']) for s in data['streams'] if s['codec_type'] == 'video' and s.get('duration') not in (None, 'N/A')]
        duration_ms = round((min(durations) if durations else float(data['format']['duration'])) * 1000)
        if duration_ms < 1:
            raise HTTPException(422, 'Material duration is empty')
        return dict(id=key, name=name, url=stored, sha256=actual, duration_ms=duration_ms, video='video' in kinds, audio='audio' in kinds), str(path)

    @staticmethod
    def _probe(path):
        ffprobe = get_ffprobe_path(get_ffmpeg_path())
        if not ffprobe:
            raise HTTPException(503, 'FFprobe is required for editing')
        try:
            probe = subprocess.run([ffprobe, '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', str(path)], check=True, capture_output=True, timeout=20)
            data = json.loads(probe.stdout)
            duration = float(data['format']['duration'])
            if not any(s['codec_type'] in ('video', 'audio') for s in data.get('streams', [])) or not math.isfinite(duration) or duration <= 0:
                raise ValueError('No playable streams')
            return data
        except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
            raise HTTPException(422, 'Material is unreadable or has no finite duration') from exc

    def upload(self, stream, filename):
        suffix = Path(filename).suffix.lower()
        if suffix not in ('.mp4', '.mov', '.mkv', '.webm', '.wav', '.mp3', '.m4a', '.aac', '.ogg'):
            raise HTTPException(422, 'Unsupported video or audio file')
        path = self.root / (uuid4().hex + suffix)
        try:
            with path.open('xb') as target:
                size = 0
                while chunk := stream.read(1024*1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise HTTPException(413, 'Material exceeds 256 MiB')
                    target.write(chunk)
            # Validate duration and streams before making the immutable file visible.
            data = self._probe(path)
            if float(data['format']['duration']) <= 0:
                raise HTTPException(422, 'Material duration is empty')
            media_id = register_media(self.user.owner_profile_id, path.relative_to(self.output_root).as_posix(), kind='editing_upload', display_name=Path(filename).name, sha256=fingerprint(path), output_root=str(self.output_root))
            return self.resolve('core:'+media_id)[0]
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    def validate(self, plan, expected_sources=None):
        if plan.scope != 'project':
            raise HTTPException(422, 'Independent edit requires project plan geometry')
        if any(m.source_episode_id for m in plan.markers):
            raise HTTPException(422, 'Independent markers cannot reference episodes')
        sources, paths = {}, {}
        for lane in plan.lanes:
            for clip in lane.clips:
                if any((clip.source_project_id, clip.source_episode_id, clip.source_frame_id, clip.source_task_id)):
                    raise HTTPException(422, 'Standalone clips reference media, not source projects')
                if lane.kind in ('subtitle', 'markers'):
                    continue
                if not clip.source_media_id:
                    raise HTTPException(422, 'Clip requires material identity')
                key = clip.source_media_id
                if key not in sources:
                    sources[key], paths[key] = self.resolve(key)
                source = sources[key]
                old = (expected_sources or {}).get(key)
                if old and source['sha256'] != old['sha256']:
                    raise HTTPException(409, 'Material changed after saving')
                if not source['video' if lane.kind == 'video' else 'audio']:
                    raise HTTPException(422, 'Material stream does not match lane')
                duration = clip.timeline_end_ms - clip.timeline_start_ms
                end = clip.source_end_ms if clip.source_end_ms is not None else clip.source_start_ms + duration
                if end > source['duration_ms'] + 1 or end - clip.source_start_ms != duration:
                    raise HTTPException(422, 'Clip range exceeds source or changes original speed')
        videos = sorted((c for l in plan.lanes if l.kind == 'video' and not l.muted for c in l.clips if c.enabled), key=lambda c: (c.timeline_start_ms, c.timeline_end_ms, c.id))
        if not videos:
            raise HTTPException(422, 'Add at least one video')
        cursor = 0
        for clip in videos:
            if clip.timeline_start_ms != cursor:
                raise HTTPException(422, 'Video clips must be contiguous')
            cursor = clip.timeline_end_ms
        if cursor != plan.target_duration_ms:
            raise HTTPException(422, 'Video sequence must fill target duration')
        return sources, paths, videos

    def save(self, edit_id, revision, plan):
        current = self.get(edit_id)
        sources, _, _ = self.validate(plan, current['sources'])
        with self.db() as db:
            record = self._get(db, edit_id)
            if record['revision'] != revision:
                raise HTTPException(409, 'Editing project changed; reload before saving')
            plan = plan.model_copy(update={'id': 'assembly-'+edit_id, 'revision': revision+1})
            record.update(revision=revision+1, plan=plan.model_dump(), sources=sources, output=None)
            self._persist(db, record)
        return record

    def versions(self, edit_id):
        with self.db() as db:
            self._get(db, edit_id)
            return [dict(revision=row[0]) for row in db.execute('SELECT revision FROM edit_versions WHERE id=? AND owner=? ORDER BY revision DESC', (edit_id, self.user.owner_profile_id))]

    def restore(self, edit_id, revision, target):
        with self.db() as db:
            self._get(db, edit_id)
            row = db.execute('SELECT data FROM edit_versions WHERE id=? AND owner=? AND revision=?', (edit_id, self.user.owner_profile_id, target)).fetchone()
            if not row or not json.loads(row[0])['plan']:
                raise HTTPException(404, 'Saved timeline version not found')
            snapshot = json.loads(row[0])
        plan = AssemblyEditPlan.model_validate(snapshot['plan'])
        self.validate(plan, snapshot['sources'])
        return self.save(edit_id, revision, plan)

    def render(self, edit_id, revision):
        record = self.get(edit_id)
        if record['revision'] != revision or not record['plan']:
            raise HTTPException(409, 'Save the current edit before rendering')
        plan = AssemblyEditPlan.model_validate(record['plan'])
        _, paths, videos = self.validate(plan, record['sources'])
        audio = [(l.kind,c) for l in plan.lanes if l.kind in ('dialogue','bgm','sfx') and not l.muted for c in l.clips if c.enabled]
        output = self.root / (uuid4().hex + '.mp4')
        try:
            ffmpeg = get_ffmpeg_path()
            if not ffmpeg:
                raise HTTPException(503, 'FFmpeg is required for editing')
            compile_assembly(plan, [paths[c.source_media_id] for c in videos], audio, [paths[c.source_media_id] for _,c in audio], str(output), ffmpeg, get_ffprobe_path(ffmpeg))
            rendered = self._probe(output)
            if abs(float(rendered['format']['duration']) * 1000 - plan.target_duration_ms) > 150:
                raise HTTPException(422, 'Rendered duration differs from saved timeline')
            with self.db() as db:
                current = self._get(db, edit_id)
                if current['revision'] != revision:
                    raise HTTPException(409, 'Edit changed while rendering')
                media_id = register_media(self.user.owner_profile_id, output.relative_to(self.output_root).as_posix(), kind='editing_output', display_name=record['title']+'.mp4', sha256=fingerprint(output), metadata={'edit_id': edit_id, 'revision': revision}, output_root=str(self.output_root))
                current['output'] = dict(url=output.relative_to(self.output_root).as_posix(), media_id=media_id, revision=revision)
                db.execute('UPDATE edits SET data=? WHERE id=? AND owner=?', (json.dumps(current), edit_id, self.user.owner_profile_id))
                return current
        except ValueError as exc:
            output.unlink(missing_ok=True)
            raise HTTPException(422, str(exc)) from exc
        except BaseException:
            output.unlink(missing_ok=True)
            raise
