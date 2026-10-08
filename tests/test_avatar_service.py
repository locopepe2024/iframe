from pathlib import Path

import pytest
from fastapi import HTTPException

from src.apps.avatar.service import AvatarStore, CharacterDesign, CreateCharacterRequest, UpdateDesignRequest
from src.apps.identity import UserContext


def _user(profile: str) -> UserContext:
    return UserContext(user_id=profile, owner_profile_id=profile, display_name=profile, access_token="")


def test_avatar_design_is_owner_scoped_and_has_no_media_assets(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    store = AvatarStore()
    created = store.create(_user("alice"), CreateCharacterRequest(
        name="Mira", profile="Writer's character notes", character_design=CharacterDesign(identity={"face": "oval"}, basis={"face": "user_specified"})
    ))
    assert created["character_id"].startswith("avatar_")
    assert created["design_revision"] == 1
    assert "reference_assets" not in created
    assert created["profile"] == "Writer's character notes"
    assert store.get(_user("alice"), created["character_id"])["character_design"]["design_draft"]["basis"]["face"] == "user_specified"
    assert store.list(_user("bob")) == []
    with pytest.raises(HTTPException) as exc:
        store.get(_user("bob"), created["character_id"])
    assert exc.value.status_code == 404


def test_avatar_design_draft_confirmation_and_history(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    store = AvatarStore()
    owner = _user("alice")
    created = store.create(owner, CreateCharacterRequest(name="Mira"))
    character_id = created["character_id"]
    saved = store.update_design(owner, character_id, UpdateDesignRequest(
        expected_revision=1, name="Mira Chen", profile="Updated profile", character_design=CharacterDesign(identity={"visual_notes": "Oval face"}, basis={"visual_notes": "creative_design_choice"}),
    ))
    assert saved["design_revision"] == 2
    assert saved["review_status"] == "draft"
    assert saved["name"] == "Mira Chen"
    assert saved["profile"] == "Updated profile"
    confirmed = store.update_design(owner, character_id, UpdateDesignRequest(
        expected_revision=2, character_design=CharacterDesign(identity={"visual_notes": "Oval face"}, basis={"visual_notes": "user_specified"}), confirmed=True,
    ))
    assert confirmed["design_revision"] == 3
    assert confirmed["character_design"]["design_revisions"][-1]["revision"] == 3
    assert store.get(owner, character_id, revision=2)["character_design"]["design_draft"]["basis"]["visual_notes"] == "creative_design_choice"
    assert store.get(owner, character_id, revision=1)["name"] == "Mira"
    with pytest.raises(HTTPException) as exc:
        store.update_design(owner, character_id, UpdateDesignRequest(expected_revision=2, character_design=CharacterDesign()))
    assert exc.value.status_code == 409


def test_avatar_cannot_confirm_empty_identity(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    store = AvatarStore()
    owner = _user("alice")
    created = store.create(owner, CreateCharacterRequest(name="Mira"))
    with pytest.raises(HTTPException) as exc:
        store.update_design(owner, created["character_id"], UpdateDesignRequest(
            expected_revision=1, character_design=CharacterDesign(), confirmed=True,
        ))
    assert exc.value.status_code == 422
    assert store.get(owner, created["character_id"])["design_revision"] == 1


def test_avatar_legacy_identity_is_read_as_editable_design(tmp_path: Path, monkeypatch):
    import json

    monkeypatch.setattr("src.apps.avatar.service.studio_owner_dir", lambda profile: str(tmp_path / profile))
    path = tmp_path / "alice" / "avatar" / "characters.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps([{"character_id": "avatar_old", "name": "Old", "identity_revision": 2,
                                 "identity": {"face": "oval"}, "review_status": "draft"}]), encoding="utf-8")
    store = AvatarStore()
    legacy = store.list(_user("alice"))[0]
    assert legacy["design_revision"] == 2
    assert legacy["character_design"]["design_draft"]["identity"]["face"] == "oval"
    assert store.get(_user("alice"), "avatar_old")["profile"] == ""
    store.update_design(_user("alice"), "avatar_old", UpdateDesignRequest(
        expected_revision=2, character_design=CharacterDesign(identity={"face": "round"}),
    ))
    assert store.get(_user("alice"), "avatar_old", revision=2)["character_design"]["design_draft"]["identity"]["face"] == "oval"
