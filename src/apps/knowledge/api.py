"""Authenticated Agent-facing knowledge ingestion and retrieval API."""

import base64
import binascii
import json
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pg8000.dbapi import Error as PostgresError
from pydantic import BaseModel, ConfigDict, Field

from ..identity import UserContext, require_user_context
from . import blob_store, store

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    domain: str = Field(min_length=1, max_length=80)


class ContentUnitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(pattern="^(text|image|table|video_segment)$")
    locator: str = Field(min_length=1, max_length=240)
    body: str | None = Field(default=None, max_length=20000)
    labels: list[str] = Field(default_factory=list, max_length=8)
    annotation: str | None = Field(default=None, max_length=2000)
    media_type: str | None = None
    media_base64: str | None = Field(default=None, max_length=24_000_000)


class SourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_uri: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=300)
    source_type: str = Field(pattern="^(web|upload|paper|video|manual)$")
    rights_status: str = Field(pattern="^(unknown|owned|licensed|public_domain)$")
    units: list[ContentUnitCreate] = Field(min_length=1, max_length=100)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=2, max_length=200)
    limit: int = Field(default=10, ge=1, le=20)
    domain: str | None = Field(default=None, max_length=80)
    kind: str | None = Field(default=None, pattern="^(text|image|table|video_segment)$")
    collection_id: UUID | None = None


def _decode_unit(unit: ContentUnitCreate) -> dict:
    result = unit.model_dump(exclude={"media_base64"})
    result["locator"] = unit.locator.strip()
    result["labels"] = [label.strip() for label in unit.labels]
    if not result["locator"] or any(not label or len(label) > 40 for label in result["labels"]):
        raise HTTPException(422, "Invalid locator or label")
    if unit.kind in ("text", "table") and not (unit.body or "").strip():
        raise HTTPException(422, "Text and table units require body")
    if unit.kind in ("image", "video_segment"):
        allowed = {"image": {"image/png", "image/jpeg", "image/webp"},
                   "video_segment": {"video/mp4", "video/webm"}}
        if unit.media_type not in allowed[unit.kind] or not unit.media_base64:
            raise HTTPException(422, "Media unit requires supported media bytes")
        try:
            media = base64.b64decode(unit.media_base64, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(422, "Invalid media encoding") from exc
        if not media or len(media) > 16 * 1024 * 1024:
            raise HTTPException(413, "Media unit exceeds 16 MiB")
        signatures = {
            "image/png": media.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg": media.startswith(b"\xff\xd8\xff"),
            "image/webp": media.startswith(b"RIFF") and media[8:12] == b"WEBP",
            "video/mp4": len(media) > 12 and media[4:8] == b"ftyp",
            "video/webm": media.startswith(b"\x1a\x45\xdf\xa3"),
        }
        if not signatures[unit.media_type]:
            raise HTTPException(422, "Media bytes do not match media type")
        result["media_bytes"] = media
    elif unit.media_type or unit.media_base64:
        raise HTTPException(422, "Text unit cannot include media")
    return result


def _source_uri(uri: str) -> str:
    value = uri.strip()
    if value.startswith("upload:") and len(value) > len("upload:"):
        return value
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(422, "Source URI must be HTTP(S) or upload:<id>")
    return value


@router.get("/collections")
def list_collections(ctx: UserContext = Depends(require_user_context)):
    try:
        with store.transaction() as connection:
            return {"collections": store.visible_collections(connection, ctx.owner_profile_id)}
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge database unavailable") from exc


@router.post("/collections", status_code=201)
def create_collection(body: CollectionCreate, ctx: UserContext = Depends(require_user_context)):
    if not body.name.strip() or not body.domain.strip():
        raise HTTPException(422, "Collection name and domain are required")
    try:
        with store.transaction() as connection:
            return store.create_owner_collection(
                connection, ctx.owner_profile_id, body.name.strip(), body.domain.strip()
            )
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge database unavailable") from exc


@router.post("/collections/{collection_id}/sources", status_code=201)
def ingest_source(collection_id: UUID, body: SourceCreate,
                  ctx: UserContext = Depends(require_user_context)):
    source_uri = _source_uri(body.source_uri)
    if not body.title.strip():
        raise HTTPException(422, "Source title is required")
    units = [_decode_unit(unit) for unit in body.units]
    if len({(unit["kind"], unit["locator"]) for unit in units}) != len(units):
        raise HTTPException(422, "Unit kind and locator must be unique per revision")
    if sum(len(unit.get("media_bytes", b"")) for unit in units) > 32 * 1024 * 1024:
        raise HTTPException(413, "Source media exceeds 32 MiB")
    canonical = body.model_dump()
    canonical["source_uri"] = source_uri
    canonical["title"] = body.title.strip()
    raw = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    try:
        with store.transaction() as connection:
            store._owner_collection(connection, str(collection_id), ctx.owner_profile_id)
            raw_key, raw_sha256 = blob_store.put("raw", raw)
            for unit in units:
                media = unit.pop("media_bytes", None)
                if media is not None:
                    unit["asset_key"], unit["media_sha256"] = blob_store.put("media", media)
            source = canonical.copy()
            return store.import_source(connection, ctx.owner_profile_id, str(collection_id),
                                       source, raw_key, raw_sha256, units)
    except store.KnowledgeAccessDenied as exc:
        raise HTTPException(404, str(exc)) from exc
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge storage unavailable") from exc


@router.get("/sources/{source_id}")
def read_source(source_id: UUID, ctx: UserContext = Depends(require_user_context)):
    try:
        with store.transaction() as connection:
            return store.get_source(connection, ctx.owner_profile_id, str(source_id))
    except store.KnowledgeAccessDenied as exc:
        raise HTTPException(404, str(exc)) from exc
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge database unavailable") from exc


@router.get("/units/{unit_id}/media")
def read_media(unit_id: UUID, ctx: UserContext = Depends(require_user_context)):
    try:
        with store.transaction() as connection:
            key, media_type = store.get_media(connection, ctx.owner_profile_id, str(unit_id))
            return Response(blob_store.get(key), media_type=media_type,
                            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
    except store.KnowledgeAccessDenied as exc:
        raise HTTPException(404, str(exc)) from exc
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge storage unavailable") from exc


@router.post("/search")
def search(body: SearchRequest, ctx: UserContext = Depends(require_user_context)):
    if not body.query.strip():
        raise HTTPException(422, "Query is required")
    try:
        with store.transaction() as connection:
            hits = store.search(connection, ctx.owner_profile_id, body.query.strip(),
                                body.limit, body.domain, body.kind,
                                str(body.collection_id) if body.collection_id else None)
            return {"hits": hits}
    except (OSError, ValueError, PostgresError, RuntimeError) as exc:
        raise HTTPException(503, "Knowledge database unavailable") from exc
