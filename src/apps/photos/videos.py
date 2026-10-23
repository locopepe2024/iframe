"""Opt-in companion video uploads, separate from photo date/people records."""

import hashlib
import json
import math
from io import BytesIO
from PIL import Image
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path as APIPath, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from ..identity import UserContext, require_user_context

MAX_BYTES = 25 * 1024 * 1024
MAX_SECONDS = 300
router = APIRouter(prefix="/videos", tags=["companion-videos"])
Owner = Annotated[UserContext, Depends(require_user_context)]


def database() -> Path:
    configured = os.getenv("IFRAME_PHOTOS_LOCAL_DB_PATH", "")
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, "Demo storage is not configured")
    target = path.with_name("companion-videos.db")
    with sqlite3.connect(target, timeout=10) as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS companion_videos (
            owner TEXT NOT NULL, id TEXT NOT NULL, operation TEXT NOT NULL,
            digest TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
            duration REAL NOT NULL, original BLOB NOT NULL, thumbnail BLOB NOT NULL,
            PRIMARY KEY(owner,id), UNIQUE(owner,operation))""")
    return target


Store = Annotated[Path, Depends(database)]


def prepare(raw: bytes) -> tuple[str, float, bytes]:
    """Local files only; bounded duration/dimensions and subprocess execution."""
    if not raw:
        raise HTTPException(422, "Empty video")
    with tempfile.TemporaryDirectory(prefix="companion-video-") as folder:
        source = Path(folder) / "input"
        source.write_bytes(raw)
        try:
            probe = subprocess.run([
                "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
                "-show_entries", "format=format_name,duration:stream=codec_type,width,height",
                "-of", "json", str(source),
            ], check=True, capture_output=True, timeout=10)
            info = json.loads(probe.stdout)
            streams = [s for s in info["streams"] if s.get("codec_type") == "video"]
            duration = float(info["format"].get("duration", 0))
            if len(streams) != 1 or not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
                raise ValueError("Invalid duration or video streams")
            width, height = int(streams[0]["width"]), int(streams[0]["height"])
            if min(width, height) < 1 or width * height > 20_000_000:
                raise ValueError("Video dimensions exceed limit")
            formats = info["format"]["format_name"].split(",")
            if "mp4" in formats or "mov" in formats:
                mime = "video/quicktime" if raw[8:12] == b"qt  " else "video/mp4"
            elif "webm" in formats:
                mime = "video/webm"
            else:
                raise ValueError("Unsupported container")
            result = subprocess.run([
                "ffmpeg", "-v", "error", "-nostdin", "-threads", "1",
                "-protocol_whitelist", "file,pipe", "-i", str(source),
                "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease",
                "-f", "image2pipe", "-c:v", "png", "pipe:1",
            ], check=True, capture_output=True, timeout=15)
            if len(result.stdout) > 2_000_000:
                raise ValueError("Video thumbnail exceeds limit")
            with Image.open(BytesIO(result.stdout)) as image:
                output = BytesIO()
                image.convert("RGB").save(output, "WEBP", quality=82)
            return mime, duration, output.getvalue()
        except FileNotFoundError as exc:
            raise HTTPException(503, "Video tools are unavailable") from exc
        except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, "Choose a valid MP4, MOV or WebM video, at most 5 minutes") from exc


def save(path: Path, owner: str, operation: str, raw: bytes, name: str):
    digest = hashlib.sha256(raw).hexdigest()
    with sqlite3.connect(path, timeout=10) as connection:
        existing = connection.execute("SELECT id,digest,name FROM companion_videos WHERE owner=? AND operation=?", (owner, operation)).fetchone()
    if existing:
        if existing[1:] != (digest, name):
            raise HTTPException(409, "Upload identifier belongs to a different file")
        return {"video_id": existing[0], "name": name, "created": False}
    mime, duration, thumbnail = prepare(raw)
    identifier = uuid4().hex
    with sqlite3.connect(path, timeout=10) as connection:
        # Atomic deduplication also covers concurrent retries after a lost response.
        connection.execute("INSERT OR IGNORE INTO companion_videos VALUES (?,?,?,?,?,?,?,?,?)",
                           (owner, identifier, operation, digest, name, mime, duration, raw, thumbnail))
        result = connection.execute("SELECT id,digest,name FROM companion_videos WHERE owner=? AND operation=?", (owner, operation)).fetchone()
        if result[1:] != (digest, name):
            raise HTTPException(409, "Upload identifier belongs to a different file")
    return {"video_id": result[0], "name": name, "created": result[0] == identifier}


@router.post("/uploads/{operation}", status_code=201)
async def upload(request: Request, identity: Owner, store: Store,
                 operation: str = APIPath(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$"),
                 name: str = Query(min_length=1, max_length=255)):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Video exceeds 25 MB")
        raw.extend(chunk)
    return await run_in_threadpool(save, store, identity.owner_profile_id, operation, bytes(raw), name)


@router.get("")
def videos(identity: Owner, store: Store, query: str = Query(default="", max_length=100),
           after_id: str = Query(default="", max_length=80), limit: int = Query(default=20, ge=1, le=50)):
    with sqlite3.connect(store, timeout=10) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute("""SELECT id AS video_id,name,duration FROM companion_videos
            WHERE owner=? AND id>? AND instr(lower(name),lower(?))>0 ORDER BY id LIMIT ?""",
            (identity.owner_profile_id, after_id, query, limit + 1)).fetchall()
    return {"videos": [dict(r) for r in rows[:limit]], "next_after_id": rows[limit - 1]["video_id"] if len(rows) > limit else None}


@router.get("/{identifier}/{kind}")
def media(identifier: str, kind: str, identity: Owner, store: Store):
    if kind not in {"original", "thumbnail"}:
        raise HTTPException(404, "Video unavailable")
    with sqlite3.connect(store, timeout=10) as connection:
        row = connection.execute(f"SELECT {kind},mime FROM companion_videos WHERE owner=? AND id=?",
                                 (identity.owner_profile_id, identifier)).fetchone()
    if not row:
        raise HTTPException(404, "Video unavailable")
    return Response(row[0], media_type="image/webp" if kind == "thumbnail" else row[1], headers={
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    })
