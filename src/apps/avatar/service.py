from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..identity import UserContext
from ..studio_access import require_studio_user, studio_owner_dir


class IdentityDesign(BaseModel):
    face: str | None = None
    facial_features: str | None = None
    skin: str | None = None
    body: str | None = None
    age_appearance: str | None = None
    gender_expression: str | None = None
    base_hair: str | None = None
    identity_anchors: list[str] = Field(default_factory=list)


class CreateCharacterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    identity: IdentityDesign = Field(default_factory=IdentityDesign)


class UpdateIdentityRequest(BaseModel):
    identity: IdentityDesign
    expected_revision: int = Field(ge=1)


class AvatarStore:
    """Owner-scoped persistence for Avatar identities, separate from assets."""

    _lock = threading.RLock()

    def _path(self, user: UserContext) -> Path:
        return Path(studio_owner_dir(user.owner_profile_id)) / "avatar" / "characters.json"

    def _read(self, user: UserContext) -> list[dict[str, Any]]:
        path = self._path(user)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("Avatar character store is unreadable") from exc
        if not isinstance(payload, list):
            raise RuntimeError("Avatar character store has invalid format")
        return payload

    def _write(self, user: UserContext, records: list[dict[str, Any]]) -> None:
        path = self._path(user)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)

    def list(self, user: UserContext) -> list[dict[str, Any]]:
        with self._lock:
            return self._read(user)

    def create(self, user: UserContext, request: CreateCharacterRequest) -> dict[str, Any]:
        name = request.name.strip()
        if not name:
            raise ValueError("Avatar character name is required")
        record = {
            "character_id": f"avatar_{uuid.uuid4().hex[:16]}",
            "name": name,
            "identity_revision": 1,
            "identity": request.identity.model_dump(exclude_none=True),
            "reference_assets": [],
            "review_status": "draft",
        }
        with self._lock:
            records = self._read(user)
            records.append(record)
            self._write(user, records)
        return record

    def get(self, user: UserContext, character_id: str, revision: int | None = None) -> dict[str, Any]:
        with self._lock:
            record = next((item for item in self._read(user) if item.get("character_id") == character_id), None)
        if record is None:
            raise HTTPException(status_code=404, detail="Avatar character not found")
        if revision is not None and revision != record["identity_revision"]:
            snapshot = next((item for item in record.get("revision_history", []) if item["identity_revision"] == revision), None)
            if snapshot is None:
                raise HTTPException(status_code=404, detail="Avatar identity revision not found")
            return {**record, "identity_revision": revision, "identity": snapshot["identity"], "revision_history": []}
        return record

    def update_identity(self, user: UserContext, character_id: str, request: UpdateIdentityRequest) -> dict[str, Any]:
        with self._lock:
            records = self._read(user)
            record = next((item for item in records if item.get("character_id") == character_id), None)
            if record is None:
                raise HTTPException(status_code=404, detail="Avatar character not found")
            actual = int(record.get("identity_revision", 1))
            if request.expected_revision != actual:
                raise HTTPException(status_code=409, detail={"code": "AVATAR_REVISION_CONFLICT", "actual_revision": actual})
            history = list(record.get("revision_history") or [])
            history.append({"identity_revision": actual, "identity": record.get("identity", {})})
            record["identity_revision"] = actual + 1
            record["identity"] = request.identity.model_dump(exclude_none=True)
            record["revision_history"] = history
            record["review_status"] = "needs_user_review"
            self._write(user, records)
            return record


store = AvatarStore()
router = APIRouter(prefix="/avatar", tags=["avatar"])


@router.get("/characters")
def list_avatar_characters(user: UserContext = Depends(require_studio_user)):
    return {"characters": store.list(user)}


@router.post("/characters", status_code=201)
def create_avatar_character(request: CreateCharacterRequest, user: UserContext = Depends(require_studio_user)):
    try:
        return store.create(user, request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/characters/{character_id}")
def get_avatar_character(character_id: str, revision: int | None = None, user: UserContext = Depends(require_studio_user)):
    return store.get(user, character_id, revision)


@router.put("/characters/{character_id}/identity")
def update_avatar_identity(character_id: str, request: UpdateIdentityRequest, user: UserContext = Depends(require_studio_user)):
    return store.update_identity(user, character_id, request)
