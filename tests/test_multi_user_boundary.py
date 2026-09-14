import json
import sqlite3
from pathlib import Path

import pytest

from src.apps.identity import UserContext, _extract_bearer
from src.apps.playground.storage import PlaygroundStorage
from src.apps.user_config import UserConfigStore, UserConfigUpdate


def identity(user: str, profile: str) -> UserContext:
    return UserContext(
        user_id=user,
        owner_profile_id=profile,
        display_name=user,
        access_token=f"token-{user}",
    )


def storage(tmp_path: Path, user: str, profile: str) -> PlaygroundStorage:
    root = tmp_path / profile
    return PlaygroundStorage(
        owner_user_id=user,
        owner_profile_id=profile,
        history_path=str(root / "history.json"),
        templates_path=str(root / "templates.json"),
        sessions_path=str(root / "sessions.json"),
    )


def test_missing_bearer_is_rejected():
    with pytest.raises(Exception) as exc_info:
        _extract_bearer(None)
    assert getattr(exc_info.value, "status_code", None) == 401


def test_playground_sessions_are_profile_scoped(tmp_path: Path):
    user_a = storage(tmp_path, "user-a", "profile-a")
    user_b = storage(tmp_path, "user-b", "profile-b")

    session_a = user_a.create_session("A private session")

    assert user_a.get_session(session_a.id) is not None
    assert user_b.get_session(session_a.id) is None
    assert user_b.list_sessions() == []
    assert session_a.owner_user_id == "user-a"
    assert session_a.owner_profile_id == "profile-a"


def test_user_configs_are_separate_and_secret_is_not_returned(tmp_path: Path):
    db_path = tmp_path / "users.db"
    store = UserConfigStore(str(db_path), master_key="test-master-key")
    user_a = identity("user-a", "profile-a")
    user_b = identity("user-b", "profile-b")

    public_a = store.update(
        user_a,
        UserConfigUpdate(
            UNIART_API_KEY="sk-user-a-secret",
            UNIART_BASE_URL="https://uniart.fun/v1",
            preferences={"locale": "zh-CN"},
        ),
    )
    store.update(user_b, UserConfigUpdate(UNIART_API_KEY="sk-user-b-secret"))

    assert "sk-user-a-secret" not in json.dumps(public_a)
    assert public_a["secrets_configured"]["UNIART_API_KEY"] is True
    assert store.get_runtime_uniart(user_a)["api_key"] == "sk-user-a-secret"
    assert store.get_runtime_uniart(user_b)["api_key"] == "sk-user-b-secret"

    with sqlite3.connect(db_path) as connection:
        raw = connection.execute(
            "SELECT secrets_json FROM user_configs WHERE owner_profile_id = ?",
            ("profile-a",),
        ).fetchone()[0]
    assert "sk-user-a-secret" not in raw


def test_user_config_requires_master_key_for_secret_write(tmp_path: Path):
    store = UserConfigStore(str(tmp_path / "users.db"), master_key="")
    with pytest.raises(Exception) as exc_info:
        store.update(identity("user-a", "profile-a"), UserConfigUpdate(UNIART_API_KEY="sk-secret"))
    assert getattr(exc_info.value, "status_code", None) == 503
