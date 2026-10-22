"""Isolated, explicitly configured photo-date API; no upload or consent endpoints."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from ..identity import UserContext, require_user_context
from .date_store import DateStore, OperationConflict, PhotoNotAvailable, TimeConsentRequired
from .dates import DateRevisionConflict, ManualPrecision


def get_store() -> DateStore:
    configured = os.getenv("IFRAME_PHOTOS_LOCAL_DB_PATH", "")
    path = Path(configured)
    if not configured or not path.is_absolute() or not path.is_file():
        raise HTTPException(503, "Photo storage is not configured")
    return DateStore(path, initialize=False)


class DateMutation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    expected_revision: int = Field(ge=1)
    consent_version: int = Field(ge=1)
    operation_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")


class DateCorrection(DateMutation):
    value: str = Field(min_length=4, max_length=10)
    precision: ManualPrecision


class DateRestoration(DateMutation):
    target_revision: int = Field(ge=1)


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
Store = Annotated[DateStore, Depends(get_store)]
router = APIRouter(prefix="/photos", tags=["photo-date-trial"])


@router.get("/{photo_id}/date")
def read_date(photo_id: str, identity: Owner, store: Store):
    with api_errors():
        return store.read(identity.owner_profile_id, photo_id)


@router.get("/{photo_id}/date/history")
def read_history(photo_id: str, identity: Owner, store: Store,
                 after_revision: int = Query(default=0, ge=0),
                 limit: int = Query(default=50, ge=1, le=100)):
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
