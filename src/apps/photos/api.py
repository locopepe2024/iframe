"""Isolated local photo Demo API with explicit consent and synchronous date rules."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response, Path as APIPath
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from ..identity import UserContext, require_user_context
from .date_store import OperationConflict, PhotoNotAvailable, TimeConsentRequired
from .dates import DateRevisionConflict, ManualPrecision
from . import media
from .workflow import PhotoWorkflowStore
from .analysis import analyze_photo, AnalysisUnavailable, AnalysisCredentialRejected


def get_store() -> PhotoWorkflowStore:
    configured = os.getenv("IFRAME_PHOTOS_LOCAL_DB_PATH", "")
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, "Photo storage is not configured")
    return PhotoWorkflowStore(path, initialize=False)


class DateMutation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expected_revision: int = Field(ge=1)
    consent_version: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")


class AnalysisPermission(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    allow_external_analysis: Literal[True]


class DescriptionConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    description: str = Field(min_length=1, max_length=1600, pattern=r"\S")
    expected_revision: int = Field(ge=0)
    operation_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")


class StoryConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    text: str = Field(min_length=1, max_length=4000, pattern=r"\S")
    expected_revision: int = Field(ge=0)
    operation_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")


class DateCorrection(DateMutation):
    value: str = Field(min_length=4, max_length=10)
    precision: ManualPrecision


class DateRestoration(DateMutation):
    target_revision: int = Field(ge=1)


class TimeAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    question_id: str = Field(min_length=1, max_length=80)
    granted: bool
    method: Literal["button", "voice_confirmed"]


class TimeRevocation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    expected_consent_version: int = Field(ge=0)


@contextmanager
def api_errors():
    try:
        yield
    except PhotoNotAvailable as exc:
        raise HTTPException(404, "Photo or history is not available") from exc
    except TimeConsentRequired as exc:
        raise HTTPException(403, "Current time consent is required") from exc
    except (DateRevisionConflict, OperationConflict) as exc:
        raise HTTPException(409, "Date revision or operation conflicts") from exc
    except (sqlite3.Error, OSError) as exc:
        raise HTTPException(503, "Photo storage unavailable") from exc
    except ValueError as exc:
        raise HTTPException(422, "Invalid photo date request or stored state") from exc


# Demo uses the existing workspace identity, including browser/key-fingerprint
# scopes. Replace this dependency with registered-account auth before production.
Owner = Annotated[UserContext, Depends(require_user_context)]
Store = Annotated[PhotoWorkflowStore, Depends(get_store)]
router = APIRouter(prefix="/photos", tags=["photo-date-trial"])


@router.get("/batches/{batch_id}")
def batch_status(batch_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.batch_status(identity.owner_profile_id, batch_id)


@router.post("/batches/{batch_id}/time-question", status_code=201)
def time_question(batch_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.time_question(identity.owner_profile_id, batch_id)


@router.post("/batches/{batch_id}/time-consent")
def time_answer(batch_id: str, body: TimeAnswer, identity: Owner, store: Store):
    with api_errors():
        return store.answer_time(identity.owner_profile_id, batch_id,
                                 actor=identity.user_id, **body.model_dump())


@router.post("/batches/{batch_id}/revoke-time")
def revoke_time(batch_id: str, body: TimeRevocation, identity: Owner, store: Store):
    with api_errors():
        return store.revoke_time(identity.owner_profile_id, batch_id,
                                 actor=identity.user_id, **body.model_dump())


@router.post("/{photo_id}/organize-time")
def organize_time(photo_id: str, body: DateMutation, identity: Owner, store: Store):
    with api_errors():
        return store.organize_time(owner=identity.owner_profile_id, photo_id=photo_id,
                                   actor=identity.user_id, **body.model_dump())


@router.get("/albums")
def albums(identity: Owner, store: Store, view: Literal["all", "pending"] = "all",
            year: int | None = Query(default=None, ge=1, le=9999),
            after_id: str = Query(default="", max_length=80),
            limit: int = Query(default=50, ge=1, le=100),
            query: str = Query(default="", max_length=100)):
    with api_errors():
        return store.album_page(identity.owner_profile_id, view=view, year=year,
                                after_id=after_id, limit=limit, query=query)


@router.post("/uploads/{upload_id}", status_code=201)
async def upload(request: Request, identity: Owner, store: Store,
                 upload_id: str = APIPath(min_length=1, max_length=120,
                                          pattern=r"^[a-zA-Z0-9_-]+$")):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > media.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Image exceeds upload limit")
        raw.extend(chunk)
    with api_errors():
        try:
            prepared = await run_in_threadpool(media.prepare_photo, bytes(raw))
        except media.ImageLimitExceeded as exc:
            raise HTTPException(413, "Image exceeds processing limits") from exc
        return await run_in_threadpool(store.upload, identity.owner_profile_id, upload_id, prepared)


def _read_media(photo_id, identity, store, *, thumbnail):
    with api_errors():
        raw, media_type = store.media(identity.owner_profile_id, photo_id, thumbnail=thumbnail)
        return Response(raw, media_type=media_type, headers={
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        })


@router.get("/{photo_id}/original")
def original(photo_id: str, identity: Owner, store: Store):
    return _read_media(photo_id, identity, store, thumbnail=False)


@router.get("/{photo_id}/thumbnail")
def thumbnail(photo_id: str, identity: Owner, store: Store):
    return _read_media(photo_id, identity, store, thumbnail=True)


@router.get("/{photo_id}/date")
def read_date(photo_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.read(identity.owner_profile_id, photo_id)


@router.get("/{photo_id}/analysis")
def read_analysis(photo_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.analysis(identity.owner_profile_id, photo_id)


@router.get("/{photo_id}/story")
def read_story(photo_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.story(identity.owner_profile_id, photo_id)


@router.get("/{photo_id}/story/history")
def story_history(photo_id: str, identity: Owner, store: Store,
                  after_revision: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100)):
    with api_errors():
        rows = store.story_history(identity.owner_profile_id, photo_id, after_revision, limit + 1)
        return {"changes": rows[:limit], "next_after_revision": rows[limit - 1]["revision"] if len(rows) > limit else None}


@router.post("/{photo_id}/story")
def save_story(photo_id: str, body: StoryConfirmation, identity: Owner, store: Store):
    with api_errors():
        return store.save_story(identity.owner_profile_id, photo_id, identity.user_id, **body.model_dump())


@router.get("/{photo_id}/description")
def read_description(photo_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.description_review(identity.owner_profile_id, photo_id)


@router.get("/{photo_id}/description/history")
def description_history(photo_id: str, identity: Owner, store: Store,
                        after_revision: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100)):
    with api_errors():
        rows = store.description_history(identity.owner_profile_id, photo_id, after_revision, limit + 1)
        return {"changes": rows[:limit], "next_after_revision": rows[limit - 1]["revision"] if len(rows) > limit else None}


@router.post("/{photo_id}/description")
def confirm_description(photo_id: str, body: DescriptionConfirmation, identity: Owner, store: Store):
    with api_errors():
        return store.confirm_description(identity.owner_profile_id, photo_id, identity.user_id, **body.model_dump())


@router.post("/{photo_id}/analysis")
def create_analysis(photo_id: str, body: AnalysisPermission, identity: Owner, store: Store):
    with api_errors():
        existing = store.analysis(identity.owner_profile_id, photo_id)
        if existing:
            return existing
        raw, _ = store.media(identity.owner_profile_id, photo_id, thumbnail=True)
        try:
            result = analyze_photo(raw, identity)
        except AnalysisCredentialRejected as exc:
            raise HTTPException(502, "当前用户的 UniArt 渠道拒绝访问，请在创作台检查渠道配置。") from exc
        except AnalysisUnavailable as exc:
            raise HTTPException(503, "照片分析暂不可用，请稍后重试。") from exc
        return store.save_analysis(identity.owner_profile_id, photo_id, identity.user_id, result)


@router.get("/{photo_id}/date/history")
def read_history(photo_id: str, identity: Owner, store: Store,
                 after_revision: int = Query(default=0, ge=0),
                 limit: int = Query(default=50, ge=1, le=100),
            query: str = Query(default="", max_length=100)):
    with api_errors():
        changes = store.history(
            identity.owner_profile_id, photo_id, after_revision=after_revision, limit=limit + 1,
        )
        page = changes[:limit]
        return {
            "changes": page,
            "next_after_revision": page[-1].revision if len(changes) > limit else None,
        }


@router.patch("/{photo_id}/date")
def correct(photo_id: str, body: DateCorrection, identity: Owner, store: Store):
    with api_errors():
        return store.correct(
            owner=identity.owner_profile_id, actor=identity.user_id,
            photo_id=photo_id, **body.model_dump(),
        )


@router.post("/{photo_id}/date/restore")
def restore(photo_id: str, body: DateRestoration, identity: Owner, store: Store):
    with api_errors():
        return store.restore(
            owner=identity.owner_profile_id, actor=identity.user_id,
            photo_id=photo_id, **body.model_dump(),
        )


def create_app() -> FastAPI:
    """Local test entrypoint; explicitly not mounted in the main product."""
    app = FastAPI(title="Photo date trial")

    @app.middleware("http")
    async def private_responses(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        return response

    app.include_router(router)
    return app
