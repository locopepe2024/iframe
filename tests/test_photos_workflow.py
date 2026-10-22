from datetime import datetime, timedelta, timezone
from io import BytesIO
import sqlite3

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.apps.identity import UserContext, require_user_context
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = DateStore(tmp_path / "photos.db")
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(store.path))
    app = create_app()
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner", "", "")
    with TestClient(app) as client:
        raw = BytesIO()
        exif = Image.Exif()
        exif[34665] = {36867: "1985:06:07 08:09:10"}
        Image.new("RGB", (8, 8)).save(raw, "JPEG", exif=exif)
        photo = client.post("/photos/uploads/first", content=raw.getvalue()).json()
        yield client, store, app, photo


def question(client, photo):
    response = client.post(f"/photos/batches/{photo['batch_id']}/time-question")
    assert response.status_code == 201
    return response.json()


def answer(client, photo, q, granted=True):
    return client.post(f"/photos/batches/{photo['batch_id']}/time-consent", json={
        "question_id": q["question_id"], "granted": granted, "method": "button",
    })


def organize(client, photo, **updates):
    return client.post(f"/photos/{photo['photo_id']}/organize-time", json={
        "consent_version": 1, "expected_revision": 1, "operation_id": "run1", **updates,
    })


def test_uploaded_photo_authorization_organization_list_and_revoke(setup):
    client, store, _, photo = setup
    assert organize(client, photo).status_code == 403
    assert client.get("/photos/albums?view=pending").json()["photos"][0]["date"]["reason"] == "not_processed"
    q = question(client, photo)
    assert q["scope"] == "time"
    assert q["processing_location"] == "demo_server_local"
    consent = answer(client, photo, q)
    assert consent.status_code == 200
    assert consent.json()["consent_version"] == 1
    assert answer(client, photo, q).json() == consent.json()
    response = organize(client, photo)
    assert response.status_code == 200
    assert response.json()["date"]["value"] == "1985-06-07T08:09:10"
    assert organize(client, photo).json() == response.json()
    rows = client.get("/photos/albums?year=1985").json()["photos"]
    assert [row["photo_id"] for row in rows] == [photo["photo_id"]]
    assert client.get("/photos/albums?view=pending").json()["photos"] == []
    assert store.history("owner", photo["photo_id"])[-1].kind == "organize"
    revoke_url = f"/photos/batches/{photo['batch_id']}/revoke-time"
    revoke = client.post(revoke_url, json={"expected_consent_version": 1})
    assert revoke.status_code == 200
    assert revoke.json()["consent_version"] == 2
    assert client.post(revoke_url, json={"expected_consent_version": 1}).json() == revoke.json()
    assert organize(client, photo, expected_revision=2, operation_id="run2").status_code == 403
    assert client.get(f"/photos/{photo['photo_id']}/original").status_code == 200
    assert store.read("owner", photo["photo_id"]).album_year == 1985


def test_replaced_expired_and_foreign_questions_cannot_authorize(setup):
    client, store, app, photo = setup
    first = question(client, photo)
    second = question(client, photo)
    assert answer(client, photo, first).status_code == 409
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE photo_time_questions SET expires_at = ?", (
            (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
        ))
    assert answer(client, photo, second).status_code == 409
    third = question(client, photo)
    app.dependency_overrides[require_user_context] = lambda: UserContext("other", "other", "", "")
    assert answer(client, photo, third).status_code == 404
    assert client.get("/photos/albums").json()["photos"] == []


def test_decline_retry_and_answer_conflict(setup):
    client, store, _, photo = setup
    q = question(client, photo)
    assert answer(client, photo, q, False).json()["granted"] is False
    assert answer(client, photo, q, True).status_code == 409
    assert organize(client, photo).status_code == 403
    q = question(client, photo)
    assert answer(client, photo, q).json()["consent_version"] == 2
    assert organize(client, photo, consent_version=2).status_code == 200
    with sqlite3.connect(store.path) as connection:
        audit = connection.execute(
            "SELECT actor, method, processing_location, question_version "
            "FROM photo_time_question_answers ORDER BY consent_version"
        ).fetchall()
    assert audit == [("user", "button", "demo_server_local", 1)] * 2


def test_organization_preserves_confirmed_year_and_list_pagination(setup):
    client, store, _, photo = setup
    answer(client, photo, question(client, photo))
    store.correct(owner="owner", photo_id=photo["photo_id"], actor="user", operation_id="manual",
                  expected_revision=1, consent_version=1, value="1970", precision="year")
    result = organize(client, photo, expected_revision=2)
    assert result.status_code == 200
    assert result.json()["date"]["value"] == "1970"
    assert result.json()["revision"] == 2
    assert len(store.history("owner", photo["photo_id"])) == 2
    assert client.get("/photos/albums?year=1970&limit=1").json()["photos"][0]["date"]["date"]["precision"] == "year"
    assert client.get("/photos/albums?year=1985").json()["photos"] == []


def test_missing_exif_goes_to_pending_after_explicit_organization(setup):
    client, _, _, _ = setup
    raw = BytesIO()
    Image.new("RGB", (8, 8)).save(raw, "PNG")
    photo = client.post("/photos/uploads/noexif", content=raw.getvalue()).json()
    answer(client, photo, question(client, photo))
    assert organize(client, photo).json()["reason"] == "missing"
    pending = client.get("/photos/albums?view=pending").json()
    assert photo["photo_id"] in {p["photo_id"] for p in pending["photos"]}


def test_noop_organization_receipt_is_stable_after_later_edit(setup):
    client, store, _, photo = setup
    answer(client, photo, question(client, photo))
    store.correct(owner="owner", photo_id=photo["photo_id"], actor="user", operation_id="manual",
                  expected_revision=1, consent_version=1, value="1970", precision="year")
    first = organize(client, photo, expected_revision=2)
    store.correct(owner="owner", photo_id=photo["photo_id"], actor="user", operation_id="manual2",
                  expected_revision=2, consent_version=1, value="1971", precision="year")
    assert organize(client, photo, expected_revision=2).json() == first.json()
    assert organize(client, photo, expected_revision=3).status_code == 409
    assert store.read("owner", photo["photo_id"]).date.value == "1971"


def test_album_cursor_has_no_duplicates_and_hides_foreign_rows(setup):
    client, _, _, photo = setup
    raw = BytesIO()
    Image.new("RGB", (8, 8)).save(raw, "PNG")
    second = client.post("/photos/uploads/second", content=raw.getvalue()).json()
    first_page = client.get("/photos/albums?limit=1").json()
    cursor = first_page["next_after_id"]
    assert cursor is not None
    next_page = client.get(f"/photos/albums?limit=1&after_id={cursor}").json()
    ids = [p["photo_id"] for p in first_page["photos"] + next_page["photos"]]
    assert set(ids) == {photo["photo_id"], second["photo_id"]}
    assert len(ids) == 2
    assert next_page["next_after_id"] is None


def test_explicit_initialization_migrates_old_history_without_losing_rows(tmp_path):
    from src.apps.photos.date_store import _SCHEMA
    from src.apps.photos.dates import PhotoTimeEvidence
    from src.apps.photos.workflow import PhotoWorkflowStore

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as connection:
        connection.executescript(_SCHEMA.replace(
            "kind IN ('register', 'correct', 'restore', 'organize')",
            "kind IN ('register', 'correct', 'restore')",
        ))
    old = DateStore(path, initialize=False)
    old.register_photo("owner", "batch", "photo", PhotoTimeEvidence())
    old.set_time_consent("owner", "batch", granted=True)
    upgraded = PhotoWorkflowStore(path)
    upgraded.organize_time(owner="owner", photo_id="photo", actor="user", operation_id="run",
                            expected_revision=1, consent_version=1)
    assert [c.kind for c in upgraded.history("owner", "photo")] == ["register", "organize"]
    DateStore(path)  # Repeated initialization is safe.
    assert len(upgraded.history("owner", "photo")) == 2
