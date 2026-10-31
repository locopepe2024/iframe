"""Owner material collection: immutable copies, explicit promotion and versions.

This store never removes source blobs or authorizes cross-product garbage collection.
"""
from contextlib import contextmanager, closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
from uuid import uuid4
from urllib.parse import urlsplit

from fastapi import HTTPException
from ...utils.managed_media_root import ManagedMediaRoot


class MaterialLibrary:
    def __init__(self, storage):
        self.storage = storage
        self.root = Path(storage.asset_dir).resolve() / 'materials'
        ManagedMediaRoot(storage.media_root).resolve(str(self.root))
        self.database = self.root / 'library.sqlite3'

    @contextmanager
    def db(self):
        self.root.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.database, timeout=20)) as db:
            db.row_factory = sqlite3.Row
            db.execute('CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, parent_version_id TEXT, reference TEXT NOT NULL, sha256 TEXT NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL, media_type TEXT NOT NULL, created_at REAL NOT NULL, UNIQUE(reference, sha256))')
            db.commit()
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @staticmethod
    def public(row):
        result = dict(row)
        result.pop('filename', None)
        result.update(retention_state='permanent', content_url=f"/playground/material-library/{row['id']}/content")
        return result

    def list(self):
        if not self.database.is_file():
            return []
        with closing(sqlite3.connect(self.database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            db.row_factory = sqlite3.Row
            return [self.public(row) for row in db.execute('SELECT * FROM versions ORDER BY created_at DESC, id DESC')]

    def content(self, version_id):
        if not re.fullmatch(r'[a-f0-9]{32}', version_id) or not self.database.is_file():
            raise HTTPException(404, 'Saved material not found')
        with closing(sqlite3.connect(self.database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            row = db.execute('SELECT filename FROM versions WHERE id=?', (version_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Saved material not found')
        path = (self.root / row[0]).resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise HTTPException(404, 'Saved material file not found')
        return path

    def resolve(self, reference):
        if urlsplit(reference).scheme or urlsplit(reference).netloc:
            raise HTTPException(422, 'Select an owned Playground material')
        reference = urlsplit(reference).path
        match = re.fullmatch(r'/playground/material-library/([a-f0-9]{32})/content', reference)
        if match:
            return self.content(match[1])
        if not reference.startswith(('/playground/input-media/', '/playground/media/')):
            raise HTTPException(422, 'Select an owned Playground material')
        try:
            stored = self.storage.resolve_media_reference(reference)
            root = ManagedMediaRoot(self.storage.media_root)
            if stored.startswith(('output/', 'outputs/')):
                path = root.resolve(stored)
            else:
                try:
                    path = root.resolve(str(Path(stored).absolute()))
                except ValueError:
                    path = root.resolve(stored)
            if not path.is_relative_to(Path(self.storage.output_dir).resolve()) or not path.is_file():
                raise ValueError('Outside owner storage')
            return path
        except (ValueError, OSError) as exc:
            raise HTTPException(404, 'Material not found') from exc

    def promote(self, reference, title='', *, parent_reference=None):
        if urlsplit(reference).scheme or urlsplit(reference).netloc:
            raise HTTPException(422, 'Select an owned Playground material')
        reference = urlsplit(reference).path
        path = self.resolve(reference)
        suffix = path.suffix.lower()
        if suffix not in ('.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.mkv', '.wav', '.mp3', '.m4a', '.aac', '.ogg'):
            raise HTTPException(422, 'Unsupported material type')
        # Copy and hash the same bytes. The source is never modified.
        target = self.root / (uuid4().hex + suffix)
        try:
            with self.db() as db:
                digest = hashlib.sha256()
                with path.open('rb') as source, target.open('xb') as output:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        output.write(chunk)
                sha = digest.hexdigest()
                prior = db.execute('SELECT * FROM versions WHERE reference=? AND sha256=?', (reference, sha)).fetchone()
                if prior:
                    target.unlink()
                    return self.public(prior)
                # A child edit can append an immutable version of a saved material.
                parent = None
                if parent_reference:
                    parent_reference = urlsplit(parent_reference).path
                    parent = db.execute('SELECT * FROM versions WHERE reference=? ORDER BY created_at DESC LIMIT 1', (parent_reference,)).fetchone()
                    match = re.fullmatch(r'/playground/material-library/([a-f0-9]{32})/content', parent_reference)
                    if match:
                        parent = db.execute('SELECT * FROM versions WHERE id=?', (match[1],)).fetchone()
                version_id = uuid4().hex
                asset_id = parent['asset_id'] if parent else uuid4().hex
                media_type = 'image' if suffix in ('.png', '.jpg', '.jpeg', '.webp') else 'video' if suffix in ('.mp4', '.mov', '.webm', '.mkv') else 'audio'
                db.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?)', (version_id, asset_id, parent['id'] if parent else None, reference, sha, (title.strip() or path.name)[:200], target.name, media_type, time.time()))
                result = self.public(db.execute('SELECT * FROM versions WHERE id=?', (version_id,)).fetchone())
            return result
        except BaseException:
            target.unlink(missing_ok=True)
            raise

    def parent_for_edit(self, reference):
        if urlsplit(reference).scheme or urlsplit(reference).netloc:
            raise HTTPException(422, 'Select an owned Playground material')
        reference = urlsplit(reference).path
        return next((row for row in self.list() if row['reference'] == reference or row['content_url'] == reference), None)
