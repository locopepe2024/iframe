"""Immutable local edits of owned Playground images; no provider execution."""
from contextlib import contextmanager, closing
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import time
from uuid import uuid4
import warnings

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 25 * 1024 * 1024


def inspect_image(data):
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, 'Image exceeds 25 MiB or is empty')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP') or getattr(image, 'n_frames', 1) != 1:
                    raise HTTPException(422, 'Use a still PNG, JPEG or WebP image')
                if max(image.size) > 8192 or image.width * image.height > 32_000_000:
                    raise HTTPException(413, 'Image exceeds 8192 pixels or 32 megapixels')
                image.load()
                return image.width, image.height, image.format
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(422, 'Image cannot be decoded') from exc


class ImageEditStore:
    def __init__(self, storage):
        self.storage = storage
        self.root = Path(storage.output_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def db(self):
        with closing(sqlite3.connect(self.root / 'image-edits.sqlite3', timeout=10)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL, intent TEXT NOT NULL, created REAL NOT NULL, data TEXT NOT NULL)')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def source_bytes(self, reference):
        if not reference.startswith(('/playground/input-media/', '/playground/media/')):
            raise HTTPException(422, 'Select an owned Playground image')
        try:
            path = Path(self.storage.resolve_media_reference(reference)).resolve()
            if not path.is_relative_to(self.root) or not path.is_file():
                raise ValueError('Not owned')
            with path.open('rb') as stream:
                data = stream.read(MAX_IMAGE_BYTES + 1)
        except (ValueError, OSError) as exc:
            raise HTTPException(404, 'Image not found') from exc
        width, height, fmt = inspect_image(data)
        return data, {'reference': self.storage.browser_media_reference(reference),
                      'sha256': hashlib.sha256(data).hexdigest(), 'width': width, 'height': height,
                      'mime': Image.MIME[fmt]}

    def source(self, reference):
        return self.source_bytes(reference)[1]

    def list(self, limit=50, offset=0):
        with self.db() as db:
            return [json.loads(row[0]) for row in db.execute(
                'SELECT data FROM edits ORDER BY created DESC, id DESC LIMIT ? OFFSET ?', (limit, offset))]

    def save(self, reference, source_sha256, data, title, operation_key):
        source = self.source(reference)
        if source['sha256'] != source_sha256:
            raise HTTPException(409, 'Source changed; reopen the editor')
        width, height, fmt = inspect_image(data)
        digest = hashlib.sha256(data).hexdigest()
        title = Path(title).name[:200] or 'edited.png'
        intent = json.dumps([source['reference'], source_sha256, digest, title])
        target = None
        try:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                prior = db.execute('SELECT intent, data FROM edits WHERE operation_key=?', (operation_key,)).fetchone()
                if prior:
                    if prior[0] != intent:
                        raise HTTPException(409, 'Save key already used for another edit')
                    return json.loads(prior[1])
                media_id = uuid4().hex
                filename = f'edit-{media_id}.{ {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[fmt] }'
                target = self.root / 'uploads' / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(data)
                record = {'id': media_id, 'path': f'/playground/input-media/{filename}', 'title': title,
                          'source_reference': source['reference'], 'source_sha256': source_sha256,
                          'sha256': digest, 'width': width, 'height': height, 'created_at': time.time(),
                          'operation': 'local_image_edit', 'editor_user_id': self.storage.owner_user_id}
                db.execute('INSERT INTO edits VALUES (?, ?, ?, ?, ?)',
                           (media_id, operation_key, intent, record['created_at'], json.dumps(record)))
            return record
        except BaseException:
            if target is not None:
                target.unlink(missing_ok=True)
            raise
