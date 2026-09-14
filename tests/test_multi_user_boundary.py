import json
import sqlite3
from pathlib import Path

import pytest

from src.apps.identity import UserContext, _extract_bearer
from src.apps.comic_gen.models import Script, Series
from src.apps.playground.storage import PlaygroundStorage
from src.apps.studio_access import (
    StudioOwnerMixin,
    require_studio_user,
    reset_studio_user,
    set_studio_user,
    verify_studio_resource_path,
)
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


def test_missing_studio_context_is_rejected():
    with pytest.raises(Exception) as exc_info:
        require_studio_user()
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


class StudioStore(StudioOwnerMixin):
    def _save_data(self):
        Path(self.data_file).write_text(json.dumps({key: value.model_dump() for key, value in self.scripts.items()}))

    def _save_series_data(self):
        Path(self.series_data_file).write_text(json.dumps({key: value.model_dump() for key, value in self.series_store.items()}))


def studio_pipeline(tmp_path: Path) -> StudioStore:
    pipeline = StudioStore()
    pipeline.data_file = str(tmp_path / "projects.json")
    pipeline.series_data_file = str(tmp_path / "series.json")
    pipeline.scripts = {}
    pipeline.series_store = {}
    return pipeline


def script(project_id: str, user: str | None, profile: str | None) -> Script:
    return Script(
        id=project_id,
        owner_user_id=user,
        owner_profile_id=profile,
        title=project_id,
        original_text="",
        created_at=1,
        updated_at=1,
    )


def series(series_id: str, user: str | None, profile: str | None) -> Series:
    return Series(
        id=series_id,
        owner_user_id=user,
        owner_profile_id=profile,
        title=series_id,
        created_at=1,
        updated_at=1,
    )


def test_studio_projects_and_series_are_profile_scoped(tmp_path: Path):
    pipeline = studio_pipeline(tmp_path)
    pipeline.scripts = {
        "project-a": script("project-a", "user-a", "profile-a"),
        "project-b": script("project-b", "user-b", "profile-b"),
        "legacy": script("legacy", None, None),
    }
    pipeline.series_store = {
        "series-a": series("series-a", "user-a", "profile-a"),
        "series-b": series("series-b", "user-b", "profile-b"),
    }

    token = set_studio_user(identity("user-a", "profile-a"))
    try:
        assert pipeline.get_script("project-a") is not None
        assert pipeline.get_script("project-b") is None
        assert pipeline.get_script("legacy") is None
        assert [item.id for item in pipeline.list_scripts("profile-a")] == ["project-a"]
        assert pipeline.get_series("series-a") is not None
        assert pipeline.get_series("series-b") is None
        assert [item.id for item in pipeline.list_series()] == ["series-a"]
    finally:
        reset_studio_user(token)


def test_cross_owner_episode_link_lookup_is_rejected(tmp_path: Path):
    pipeline = studio_pipeline(tmp_path)
    pipeline.scripts = {
        "project-b": script("project-b", "user-b", "profile-b"),
    }
    pipeline.series_store = {
        "series-a": series("series-a", "user-a", "profile-a"),
    }

    token = set_studio_user(identity("user-a", "profile-a"))
    try:
        assert pipeline.get_series("series-a") is not None
        assert pipeline.get_script("project-b") is None
    finally:
        reset_studio_user(token)


def test_studio_url_resource_precheck_hides_cross_owner_ids(tmp_path: Path):
    pipeline = studio_pipeline(tmp_path)
    pipeline.scripts = {
        "project-a": script("project-a", "user-a", "profile-a"),
        "project-b": script("project-b", "user-b", "profile-b"),
    }
    pipeline.series_store = {
        "series-a": series("series-a", "user-a", "profile-a"),
        "series-b": series("series-b", "user-b", "profile-b"),
    }

    verify_studio_resource_path(
        "/projects/project-a/frames",
        "profile-a",
        pipeline.scripts,
        pipeline.series_store,
    )
    verify_studio_resource_path(
        "/series/import/preview",
        "profile-a",
        pipeline.scripts,
        pipeline.series_store,
    )

    with pytest.raises(Exception) as project_error:
        verify_studio_resource_path(
            "/projects/project-b",
            "profile-a",
            pipeline.scripts,
            pipeline.series_store,
        )
    assert getattr(project_error.value, "status_code", None) == 404

    with pytest.raises(Exception) as series_error:
        verify_studio_resource_path(
            "/series/series-b/assets",
            "profile-a",
            pipeline.scripts,
            pipeline.series_store,
        )
    assert getattr(series_error.value, "status_code", None) == 404


def test_legacy_studio_owner_requires_explicit_mapping(tmp_path: Path, monkeypatch):
    pipeline = studio_pipeline(tmp_path)
    pipeline.scripts = {"legacy-project": script("legacy-project", None, None)}
    pipeline.series_store = {"legacy-series": series("legacy-series", None, None)}

    pipeline._migrate_legacy_studio_owners()
    assert pipeline.scripts["legacy-project"].owner_profile_id is None
    assert pipeline.series_store["legacy-series"].owner_profile_id is None

    monkeypatch.setenv("LUMENX_LEGACY_OWNER_USER_ID", "legacy-user")
    monkeypatch.setenv("LUMENX_LEGACY_OWNER_PROFILE_ID", "legacy-profile")
    pipeline._migrate_legacy_studio_owners()

    assert pipeline.scripts["legacy-project"].owner_user_id == "legacy-user"
    assert pipeline.scripts["legacy-project"].owner_profile_id == "legacy-profile"
    assert pipeline.series_store["legacy-series"].owner_user_id == "legacy-user"
    assert pipeline.series_store["legacy-series"].owner_profile_id == "legacy-profile"
    assert json.loads(Path(pipeline.data_file).read_text())["legacy-project"]["owner_profile_id"] == "legacy-profile"
