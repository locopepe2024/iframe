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


class CharacterDesign(BaseModel):
    """Editable character design owned by Avatar, without media ownership."""

    route: str | None = None
    age_stage: str | None = None
    identity: dict[str, Any] = Field(default_factory=dict)
    look: dict[str, Any] = Field(default_factory=dict)
    unresolved: list[str] = Field(default_factory=list)
    field_status: dict[str, str] = Field(default_factory=dict)
    skill_id: str | None = None
    skill_revision: str | None = None
    basis: dict[str, str] = Field(default_factory=dict)
    reference_asset_id: str | None = None


class CreateCharacterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    identity: IdentityDesign = Field(default_factory=IdentityDesign)
    character_design: CharacterDesign | None = None
    profile: str = Field(default="", max_length=12000)


class UpdateIdentityRequest(BaseModel):
    identity: IdentityDesign
    expected_revision: int = Field(ge=1)


class UpdateDesignRequest(BaseModel):
    character_design: CharacterDesign
    expected_revision: int = Field(ge=1)
    confirmed: bool = False
    name: str | None = Field(default=None, min_length=1, max_length=120)
    profile: str | None = Field(default=None, max_length=12000)


class AvatarStore:
    """Owner-scoped persistence for Avatar design specs, separate from assets."""

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
            records = self._read(user)
            return [self._present(record) for record in records]

    @staticmethod
    def _present(record: dict[str, Any]) -> dict[str, Any]:
        current_revision = int(record.get("design_revision", record.get("identity_revision", 1)))
        design = record.get("character_design") or {
            "design_draft": CharacterDesign(identity=record.get("identity") or {}).model_dump(exclude_none=True),
            "design_revisions": [],
        }
        return {**record, "design_revision": current_revision, "character_design": design,
                "identity_revision": current_revision, "identity": design.get("design_draft", {}).get("identity", {}),
                "profile": record.get("profile", "")}

    def create(self, user: UserContext, request: CreateCharacterRequest) -> dict[str, Any]:
        name = request.name.strip()
        if not name:
            raise ValueError("Avatar character name is required")
        design = request.character_design or CharacterDesign(
            identity=request.identity.model_dump(exclude_none=True)
        )
        record = {
            "character_id": f"avatar_{uuid.uuid4().hex[:16]}",
            "name": name,
            "profile": request.profile.strip(),
            "design_revision": 1,
            "character_design": {"design_draft": design.model_dump(exclude_none=True), "design_revisions": []},
            "review_status": "draft",
        }
        with self._lock:
            records = self._read(user)
            records.append(record)
            self._write(user, records)
        return self.get(user, record["character_id"])

    def get(self, user: UserContext, character_id: str, revision: int | None = None) -> dict[str, Any]:
        with self._lock:
            record = next((item for item in self._read(user) if item.get("character_id") == character_id), None)
        if record is None:
            raise HTTPException(status_code=404, detail="Avatar character not found")
        current_revision = int(record.get("design_revision", record.get("identity_revision", 1)))
        if revision is not None and revision != current_revision:
            snapshot = next((item for item in record.get("revision_history", []) if item.get("design_revision") == revision), None)
            if snapshot is None:
                legacy = next((item for item in record.get("revision_history", []) if item.get("identity_revision") == revision), None)
                if legacy is None:
                    raise HTTPException(status_code=404, detail="Avatar design revision not found")
                snapshot = {"character_design": {"design_draft": {"identity": legacy["identity"]}}, "review_status": "draft"}
            historical = {**record, "design_revision": revision, "identity_revision": revision,
                          "character_design": snapshot["character_design"], "review_status": snapshot["review_status"]}
            historical["name"] = snapshot.get("name", record["name"])
            historical["profile"] = snapshot.get("profile", record.get("profile", ""))
            historical["identity"] = historical["character_design"].get("design_draft", {}).get("identity", {})
            return historical
        # Compatibility projection for existing clients; Avatar's source of truth is character_design.
        return self._present(record)

    def update_design(self, user: UserContext, character_id: str, request: UpdateDesignRequest) -> dict[str, Any]:
        with self._lock:
            records = self._read(user)
            record = next((item for item in records if item.get("character_id") == character_id), None)
            if record is None:
                raise HTTPException(status_code=404, detail="Avatar character not found")
            actual = int(record.get("design_revision", record.get("identity_revision", 1)))
            if request.expected_revision != actual:
                raise HTTPException(status_code=409, detail={"code": "AVATAR_DESIGN_REVISION_CONFLICT", "actual_revision": actual})
            if request.name is not None and not request.name.strip():
                raise HTTPException(status_code=422, detail="Avatar character name is required")
            design = request.character_design.model_dump(exclude_none=True)
            if request.confirmed and not any(
                str(value).strip() for value in design.get("identity", {}).values() if isinstance(value, str)
            ) and not design.get("identity", {}).get("identity_anchors"):
                raise HTTPException(status_code=422, detail="Confirmed design requires concrete identity visual notes")
            container = record.setdefault("character_design", {
                "design_draft": CharacterDesign(identity=record.get("identity") or {}).model_dump(exclude_none=True),
                "design_revisions": [],
            })
            history = list(record.get("revision_history") or [])
            history.append({"design_revision": actual, "character_design": json.loads(json.dumps(container)),
                            "review_status": record.get("review_status", "draft"),
                            "name": record["name"], "profile": record.get("profile", "")})
            record["revision_history"] = history
            record["design_revision"] = actual + 1
            record["review_status"] = "confirmed" if request.confirmed else "draft"
            if request.name is not None:
                record["name"] = request.name.strip()
            if request.profile is not None:
                record["profile"] = request.profile
            container["design_draft"] = design
            if request.confirmed:
                container.setdefault("design_revisions", []).append({"revision": actual + 1, "design": design})
            self._write(user, records)
            return self.get(user, character_id)

    def update_identity(self, user: UserContext, character_id: str, request: UpdateIdentityRequest) -> dict[str, Any]:
        """Compatibility entry for callers still sending flat identity fields."""
        return self.update_design(user, character_id, UpdateDesignRequest(
            character_design=CharacterDesign(identity=request.identity.model_dump(exclude_none=True)),
            expected_revision=request.expected_revision,
            confirmed=False,
        ))


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


@router.put("/characters/{character_id}/design")
def update_avatar_design(character_id: str, request: UpdateDesignRequest, user: UserContext = Depends(require_studio_user)):
    return store.update_design(user, character_id, request)
