import pytest
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore
from src.apps.photos.dates import PhotoTimeEvidence


@pytest.fixture
def setup(tmp_path, monkeypatch):
    path = tmp_path / "photos.db"
    store = DateStore(path)
    store.register_photo("owner", "batch", "photo", PhotoTimeEvidence())
    store.set_time_consent("owner", "batch", granted=True)
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(path))
    app = create_app()
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "person", "owner", "Name", "validated-token",
    )
    with TestClient(app, headers={"Authorization": "Bearer test"}) as client:
        yield client, store, app


def payload(**updates):
    return dict(value="1985", precision="year", expected_revision=1,
                consent_version=1, operation_id="edit", **updates)


def test_http_date_history_and_restore(setup):
    client, store, _ = setup
    response = client.patch("/photos/photo/date", json=payload())
    assert response.status_code == 200
    assert response.json()["date"]["value"] == "1985"
    assert response.headers["cache-control"] == "private, no-store"
    assert client.patch("/photos/photo/date", json=payload()).json() == response.json()
    history = client.get("/photos/photo/date/history?limit=1").json()
    assert len(history["changes"]) == 1
    assert history["next_after_revision"] == 1
    history = client.get("/photos/photo/date/history?after_revision=1").json()
    assert history["changes"][0]["actor"] == "person"
    response = client.post("/photos/photo/date/restore", json={
        "target_revision": 1, "expected_revision": 2,
        "consent_version": 1, "operation_id": "restore",
    })
    assert response.status_code == 200
    assert response.json()["revision"] == 3
    assert store.read("owner", "photo").date is None
    assert client.get("/photos/photo/date").json()["revision"] == 3


def test_owner_spoofing_stale_writes_and_revocation(setup):
    client, store, app = setup
    assert client.patch("/photos/photo/date", json={**payload(), "owner": "other"}).status_code == 422
    assert client.patch("/photos/photo/date", json=payload()).status_code == 200
    bad = {**payload(), "operation_id": "old"}
    assert client.patch("/photos/photo/date", json=bad).status_code == 409
    assert client.patch("/photos/photo/date", json={**payload(), "value": "1990"}).status_code == 409
    store.set_time_consent("owner", "batch", granted=False)
    assert client.patch("/photos/photo/date", json=payload()).status_code == 403
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "other", "other", "Other", "token",
    )
    for suffix in ("", "/history"):
        assert client.get("/photos/photo/date" + suffix).status_code == 404
    assert client.patch("/photos/photo/date", json=payload()).status_code == 404


def test_missing_storage_never_creates_database(setup, monkeypatch, tmp_path):
    client, _, _ = setup
    monkeypatch.delenv("IFRAME_PHOTOS_LOCAL_DB_PATH")
    assert client.get("/photos/photo/date").status_code == 503
    absent = tmp_path / "not-created.db"
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(absent))
    assert client.get("/photos/photo/date").status_code == 503
    assert not absent.exists()


def test_demo_browser_workspace_is_allowed_and_scoped(setup):
    client, store, app = setup
    client.headers.pop("Authorization")
    assert client.get("/photos/photo/date").status_code == 200
    client.headers["Authorization"] = "Bearer test"
    app.dependency_overrides[require_user_context] = lambda: UserContext(
        "browser-a", "browser-a", "Browser", "",
    )
    assert client.get("/photos/photo/date").status_code == 404


@pytest.mark.parametrize("updates", [
    {"value": "1985-13", "precision": "month"},
    {"expected_revision": True}, {"consent_version": 0}, {"actor": "forged"},
])
def test_invalid_write_rejected_without_mutation(setup, updates):
    client, store, _ = setup
    assert client.patch("/photos/photo/date", json={**payload(), **updates}).status_code == 422
    assert store.read("owner", "photo").revision == 1


def test_real_identity_dependency_validates_bearer_and_scopes_demo_headers(setup, monkeypatch):
    from fastapi import HTTPException
    from src.apps.identity import UniArtIdentityClient

    client, store, app = setup
    app.dependency_overrides.clear()
    calls = []

    def me(self, token):
        calls.append(token)
        if token != "accepted":
            raise HTTPException(401, "Invalid token")
        return {"user": {"user_id": "person"}, "profile": {"profile_id": "owner"}}

    monkeypatch.setattr(UniArtIdentityClient, "me", me)
    client.headers["Authorization"] = "Bearer accepted"
    assert client.get("/photos/photo/date").status_code == 200
    assert calls == ["accepted"]
    client.headers["Authorization"] = "Bearer rejected"
    assert client.get("/photos/photo/date").status_code == 401
    client.headers.pop("Authorization")
    client.headers["X-iFrame-API-Key-Identity"] = "a" * 64
    assert client.get("/photos/photo/date").status_code == 404
    client.headers.pop("X-iFrame-API-Key-Identity")
    client.cookies.clear()
    response = client.get("/photos/photo/date")
    assert response.status_code == 404
    store.register_photo("browser-demo", "demo-batch", "demo-photo", PhotoTimeEvidence())
    client.cookies.set("lumenx-browser-profile", "demo")
    assert client.get("/photos/demo-photo/date").status_code == 200


def test_uninitialized_database_fails_closed_without_migration(setup, monkeypatch, tmp_path):
    import sqlite3

    client, _, _ = setup
    path = tmp_path / "empty.db"
    with sqlite3.connect(path):
        pass
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(path))
    response = client.get("/photos/photo/date")
    assert response.status_code == 503
    assert "no such table" not in response.text
    assert response.headers["cache-control"] == "private, no-store"
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT name FROM sqlite_master").fetchall() == []
