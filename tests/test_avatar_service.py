from pathlib import Path

import pytest
from fastapi import HTTPException

from src.apps.avatar.service import AvatarStore, CreateCharacterRequest, IdentityDesign, UpdateIdentityRequest
from src.apps.identity import UserContext


def _user(profile: str) -> UserContext:
    return UserContext(user_id=profile, owner_profile_id=profile, display_name=profile, access_token="")


def test_avatar_creation_is_persistent_and_owner_scoped(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    store = AvatarStore()
    created = store.create(_user("alice"), CreateCharacterRequest(name="Mira", identity=IdentityDesign(face="oval")))

    assert created["character_id"].startswith("avatar_")
    assert created["identity_revision"] == 1
    assert AvatarStore().get(_user("alice"), created["character_id"])["identity"]["face"] == "oval"
    assert store.list(_user("bob")) == []
    with pytest.raises(HTTPException) as exc:
        store.get(_user("bob"), created["character_id"])
    assert exc.value.status_code == 404


def test_avatar_identity_revision_conflict_preserves_history(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    store = AvatarStore()
    owner = _user("alice")
    created = store.create(owner, CreateCharacterRequest(name="Mira", identity=IdentityDesign(face="oval")))
    updated = store.update_identity(owner, created["character_id"], UpdateIdentityRequest(
        expected_revision=1, identity=IdentityDesign(face="round"),
    ))

    assert updated["identity_revision"] == 2
    assert updated["revision_history"] == [{"identity_revision": 1, "identity": {"face": "oval", "identity_anchors": []}}]
    with pytest.raises(HTTPException) as exc:
        store.update_identity(owner, created["character_id"], UpdateIdentityRequest(
            expected_revision=1, identity=IdentityDesign(face="square"),
        ))
    assert exc.value.status_code == 409
    assert store.get(owner, created["character_id"])["identity"]["face"] == "round"
    assert store.get(owner, created["character_id"], revision=1)["identity"]["face"] == "oval"


def test_avatar_rejects_blank_name(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    with pytest.raises(ValueError, match="name is required"):
        AvatarStore().create(_user("alice"), CreateCharacterRequest(name="   "))
