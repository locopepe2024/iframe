"""Reversible owner-list deletion. Never deletes or rewrites media or references."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import time
from uuid import uuid4

from fastapi import HTTPException

from ...utils.managed_media_root import ManagedMediaRoot


class MaterialTrash:
    def __init__(self, owner_profile_id, output_root):
        from .storage import PlaygroundStorage
        root = Path(PlaygroundStorage._owner_dir(owner_profile_id, output_root=str(output_root)))
        self.path = ManagedMediaRoot(str(output_root)).resolve(str((root / 'material-trash.sqlite3').absolute()))

    @staticmethod
    def public(row):
        material = json.loads(row['data'])
        if row['scope'] not in ('temporary', 'saved') or not isinstance(material, dict) or not isinstance(material.get('id'), str):
            raise ValueError('Invalid recycle bin entry')
        return dict(id=row['id'], scope=row['scope'], material=material, deleted_at=row['deleted_at'])

    def list(self):
        if not self.path.is_file():
            return []
        try:
            with closing(sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)) as db:
                db.row_factory = sqlite3.Row
                return [self.public(row) for row in db.execute('SELECT * FROM trash ORDER BY deleted_at DESC, id DESC')]
        except (sqlite3.Error, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(503, 'Material recycle bin is unavailable') from exc

    def hidden(self, scope):
        return {row['material']['id'] for row in self.list() if row['scope'] == scope}

    def move(self, scope, material):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with closing(sqlite3.connect(self.path, timeout=20)) as db:
                db.row_factory = sqlite3.Row
                db.execute('CREATE TABLE IF NOT EXISTS trash (id TEXT PRIMARY KEY, scope TEXT NOT NULL, material_id TEXT NOT NULL, data TEXT NOT NULL, deleted_at REAL NOT NULL, UNIQUE(scope, material_id))')
                db.execute('BEGIN IMMEDIATE')
                db.execute('INSERT OR IGNORE INTO trash VALUES(?,?,?,?,?)',
                           (uuid4().hex, scope, material['id'], json.dumps(material), time.time()))
                result = self.public(db.execute('SELECT * FROM trash WHERE scope=? AND material_id=?', (scope, material['id'])).fetchone())
                db.commit()
                return result
        except (sqlite3.Error, ValueError, TypeError) as exc:
            raise HTTPException(503, 'Material recycle bin is unavailable') from exc

    def restore(self, trash_id):
        if self.path.is_file():
            try:
                with closing(sqlite3.connect(self.path, timeout=20)) as db:
                    db.execute('DELETE FROM trash WHERE id=?', (trash_id,))
                    db.commit()
            except sqlite3.Error as exc:
                raise HTTPException(503, 'Material recycle bin is unavailable') from exc
        return dict(id=trash_id, restored=True)
