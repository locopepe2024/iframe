"""Immutable local edits of owned Playground images; no provider execution."""
from contextlib import contextmanager, closing
import hashlib
import os
from io import BytesIO
import json
from pathlib import Path
import re
import sqlite3
import time
from uuid import uuid4
import warnings
from urllib.parse import unquote, urlparse
from urllib.request import Request as UrlRequest, urlopen

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from ..media_registry import register_media

MAX_IMAGE_BYTES = 25 * 1024 * 1024


def analyze_panorama(data):
    """Return conservative seam and pole diagnostics for panorama admission."""
    try:
        with Image.open(BytesIO(data)) as image:
            rgba = image.convert('RGBA').resize((256, 128))
            pixels = list(rgba.getdata())
    except (OSError, ValueError, UnidentifiedImageError):
        return {'status': 'fail', 'blocking_codes': ['decode_failed']}
    width, height = rgba.size
    seam_error = sum(
        sum(abs(pixels[y * width][channel] - pixels[y * width + width - 1][channel]) for channel in range(3)) / 765
        for y in range(height)
    ) / height
    pole_rows = max(1, round(height * 0.04))
    pole = pixels[:width * pole_rows] + pixels[-width * pole_rows:]
    transparent_fraction = sum(pixel[3] < 16 for pixel in pole) / len(pole)
    black_fraction = sum(max(pixel[:3]) < 12 for pixel in pole) / len(pole)
    blocking_codes = []
    if seam_error > 0.18:
        blocking_codes.append('horizontal_seam_discontinuity')
    if transparent_fraction > 0.02:
        blocking_codes.append('transparent_pole_gap')
    if black_fraction > 0.45:
        blocking_codes.append('black_pole_gap')
    return {
        'status': 'pass' if not blocking_codes else 'review',
        'blocking_codes': blocking_codes,
        'seam_error': round(seam_error, 4),
        'transparent_pole_fraction': round(transparent_fraction, 4),
        'black_pole_fraction': round(black_fraction, 4),
    }


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
        source = {'reference': self.storage.browser_media_reference(reference),
                  'sha256': hashlib.sha256(data).hexdigest(), 'width': width, 'height': height,
                  'mime': Image.MIME[fmt]}
        if width == 2 * height:
            source['panorama_quality'] = analyze_panorama(data)
        return data, source

    def source(self, reference):
        return self.source_bytes(reference)[1]

    def import_library_variant(self, index, scope, container_id, asset_type, asset_id, variant_id, resolver):
        entry = next((item for item in index.assets
                      if item.source_scope == scope
                      and (item.source_container_id or '') == container_id
                      and item.asset_type == asset_type and item.asset_id == asset_id), None)
        if entry is None:
            raise HTTPException(404, 'Asset is not visible in this library')
        variant = next((item for item in entry.variants if item.id == variant_id), None)
        if variant is None:
            raise HTTPException(404, 'Variant does not belong to this asset')
        resolved = resolver(variant.url, self.storage.owner_profile_id)
        if Path(resolved).is_file():
            with open(resolved, 'rb') as stream:
                data = stream.read(MAX_IMAGE_BYTES + 1)
        else:
            from ...utils.oss_utils import OSSImageUploader, is_object_key
            uploader = OSSImageUploader()
            fetch_url = uploader.sign_url_for_api(resolved) if is_object_key(resolved) else ''
            if resolved.startswith(('http://', 'https://')) and uploader.is_configured:
                probe = urlparse(uploader.sign_url_for_api('__iframe_editor_probe__'))
                candidate = urlparse(resolved)
                if candidate.hostname and candidate.hostname == probe.hostname:
                    fetch_url = uploader.sign_url_for_api(unquote(candidate.path.lstrip('/')))
            if not fetch_url:
                raise HTTPException(422, 'Library variant storage is not editable')
            try:
                with urlopen(UrlRequest(fetch_url, headers={'User-Agent': 'iFrame-Studio/1.0'}), timeout=30) as remote:
                    data = remote.read(MAX_IMAGE_BYTES + 1)
            except OSError as exc:
                raise HTTPException(502, 'Could not read library image') from exc
        width, height, fmt = inspect_image(data)
        filename = f'library-{uuid4().hex}.{ {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[fmt] }'
        target = self.root / 'uploads' / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        media_id = register_media(
            self.storage.owner_profile_id,
            os.path.relpath(target, "output"),
            kind="temporary_input",
            display_name=entry.name,
            sha256=hashlib.sha256(data).hexdigest(),
            metadata={"asset_type": asset_type, "asset_id": asset_id, "variant_id": variant_id},
        )
        return {'media_id': media_id, 'path': f'/playground/input-media/{filename}', 'title': entry.name,
                'width': width, 'height': height, 'sha256': hashlib.sha256(data).hexdigest(),
                'asset_type': asset_type, 'asset_id': asset_id, 'variant_id': variant_id}

    def list(self, limit=50, offset=0):
        with self.db() as db:
            records = [json.loads(row[0]) for row in db.execute(
                'SELECT data FROM edits ORDER BY created DESC, id DESC LIMIT ? OFFSET ?', (limit, offset))]
        for record in records:
            if record.get('projection_type') == 'equirectangular' and 'panorama_quality' not in record:
                try:
                    data, _ = self.source_bytes(record['path'])
                    record['panorama_quality'] = analyze_panorama(data)
                except HTTPException:
                    record['panorama_quality'] = {'status': 'fail', 'blocking_codes': ['source_unavailable']}
        return records

    def list_panorama_assets(self, limit=50, offset=0):
        with self.db() as db:
            records = [json.loads(row[0]) for row in db.execute(
                "SELECT data FROM edits WHERE json_extract(data, '$.projection_type') = 'equirectangular' ORDER BY created DESC, id DESC")]
        admitted = []
        for record in records:
            height = record.get('height')
            if not isinstance(height, int) or height <= 0 or record.get('width') != 2 * height:
                continue
            if not isinstance(record.get('path'), str) or not re.fullmatch(r'/playground/input-media/[^/]+', record['path']):
                continue
            if not isinstance(record.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', record['sha256']):
                continue
            if not isinstance(record.get('id'), str) or not isinstance(record.get('title'), str):
                continue
            if not isinstance(record.get('panorama_quality'), dict):
                try:
                    data, _ = self.source_bytes(record['path'])
                    record['panorama_quality'] = analyze_panorama(data)
                except HTTPException:
                    continue
            if record['panorama_quality'].get('status') != 'pass':
                continue
            admitted.append({key: record[key] for key in ('id', 'path', 'title', 'sha256', 'width', 'height', 'projection_type', 'panorama_quality')})
        return admitted[offset:offset + limit]

    def save(self, reference, source_sha256, data, title, operation_key, projection_type='perspective_plane'):
        source = self.source(reference)
        if source['sha256'] != source_sha256:
            raise HTTPException(409, 'Source changed; reopen the editor')
        width, height, fmt = inspect_image(data)
        if projection_type not in ('perspective_plane', 'equirectangular'):
            raise HTTPException(422, 'Unsupported projection type')
        if projection_type == 'equirectangular' and width != 2 * height:
            raise HTTPException(422, 'Equirectangular panorama must have an exact 2:1 pixel ratio')
        if projection_type == 'equirectangular':
            quality = analyze_panorama(data)
            if quality['status'] != 'pass':
                raise HTTPException(422, 'Panorama has a seam or zenith/nadir gap; repair or regenerate it before saving')
        digest = hashlib.sha256(data).hexdigest()
        title = Path(title).name[:200] or 'edited.png'
        intent = json.dumps([source['reference'], source_sha256, digest, title, projection_type])
        target = None
        try:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                prior = db.execute('SELECT intent, data FROM edits WHERE operation_key=?', (operation_key,)).fetchone()
                if prior:
                    legacy_intent = json.dumps([source['reference'], source_sha256, digest, title])
                    if prior[0] != intent and not (projection_type == 'perspective_plane' and prior[0] == legacy_intent):
                        raise HTTPException(409, 'Save key already used for another edit')
                    return json.loads(prior[1])
                media_id = uuid4().hex
                filename = f'edit-{media_id}.{ {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[fmt] }'
                target = self.root / 'uploads' / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(data)
                register_media(
                    self.storage.owner_profile_id,
                    os.path.relpath(target, "output"),
                    kind="editor_output",
                    display_name=title,
                    sha256=digest,
                    media_id=media_id,
                    metadata={"source_reference": source['reference'], "operation": "local_image_edit"},
                )
                record = {'id': media_id, 'path': f'/playground/input-media/{filename}', 'title': title,
                          'source_reference': source['reference'], 'source_sha256': source_sha256,
                          'sha256': digest, 'width': width, 'height': height, 'projection_type': projection_type,
                          'created_at': time.time(),
                          'operation': 'local_image_edit', 'editor_user_id': self.storage.owner_user_id}
                if projection_type == 'equirectangular':
                    record['panorama_quality'] = quality
                db.execute('INSERT INTO edits VALUES (?, ?, ?, ?, ?)',
                           (media_id, operation_key, intent, record['created_at'], json.dumps(record)))
            return record
        except BaseException:
            if target is not None:
                target.unlink(missing_ok=True)
            raise
