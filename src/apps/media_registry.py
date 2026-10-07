"""Small owner-scoped registry for immutable workbench media."""

from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from uuid import uuid4


def _registry_path(owner_profile_id: str) -> str:
    digest = hashlib.sha256(owner_profile_id.encode("utf-8")).hexdigest()[:24]
    return os.path.join("output", "users", digest, "media-registry.sqlite3")


def register_media(owner_profile_id: str, storage_key: str, *, kind: str,
                   display_name: str = "", sha256: str = "", media_id: str | None = None,
                   metadata: dict | None = None) -> str:
    """Register one owner-owned material idempotently by storage key."""
    if not owner_profile_id or not storage_key or storage_key.startswith(("http://", "https://")):
        raise ValueError("media registry requires a durable storage key")
    path = _registry_path(owner_profile_id)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    media_id = media_id or uuid4().hex
    with closing(sqlite3.connect(path, timeout=10)) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS media_records (
            media_id TEXT PRIMARY KEY, storage_key TEXT UNIQUE NOT NULL,
            kind TEXT NOT NULL, display_name TEXT NOT NULL, sha256 TEXT NOT NULL,
            metadata TEXT NOT NULL, created_at REAL NOT NULL DEFAULT (unixepoch())
        )""")
        row = db.execute("SELECT media_id FROM media_records WHERE storage_key=?", (storage_key,)).fetchone()
        if row:
            db.commit()
            return row[0]
        db.execute("INSERT INTO media_records(media_id,storage_key,kind,display_name,sha256,metadata) VALUES(?,?,?,?,?,?)",
                   (media_id, storage_key, kind, display_name, sha256, json.dumps(metadata or {}, ensure_ascii=False)))
        db.commit()
    return media_id


def get_media(owner_profile_id: str, media_id: str) -> dict | None:
    path = _registry_path(owner_profile_id)
    if not os.path.isfile(path):
        return None
    with closing(sqlite3.connect(path, timeout=10)) as db:
        row = db.execute("SELECT media_id,storage_key,kind,display_name,sha256,metadata,created_at FROM media_records WHERE media_id=?", (media_id,)).fetchone()
    if not row:
        return None
    return dict(zip(("media_id", "storage_key", "kind", "display_name", "sha256", "metadata", "created_at"), row), metadata=json.loads(row[5]))
