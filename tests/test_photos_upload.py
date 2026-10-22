from io import BytesIO
import sqlite3

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from src.apps.identity import UserContext, require_user_context
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore


def jpeg(*, orientation=1, date="1985:06:07 08:09:10"):
    output = BytesIO()
    exif = Image.Exif()
    exif[274] = orientation
    exif[34665] = {36867: date, 36881: "+08:00"}
    Image.new("RGB", (80, 40), "red").save(output, "JPEG", exif=exif)
    return output.getvalue()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = DateStore(tmp_path / "photos.db")
    monkeypatch.setenv("IFRAME_PHOTOS_LOCAL_DB_PATH", str(store.path))
    app = create_app()
    app.dependency_overrides[require_user_context] = lambda: UserContext("user", "owner", "", "")
    with TestClient(app) as client:
        yield client, store, app


def test_upload_preserves_original_exif_and_orients_thumbnail_without_organizing(setup):
    client, store, app = setup
    raw = jpeg(orientation=6)
    response = client.post("/photos/uploads/first", content=raw)
    assert response.status_code == 201
    photo = response.json()
    photo_id = photo["photo_id"]
    assert photo["created"] is True
    assert client.get(f"/photos/{photo_id}/original").content == raw
    thumb = client.get(f"/photos/{photo_id}/thumbnail")
    assert thumb.headers["cache-control"] == "private, no-store"
    assert thumb.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(thumb.content)) as image:
        assert image.format == "WEBP"
        assert image.size == (40, 80)
        assert not image.getexif()
    date = store.read("owner", photo_id)
    assert date.reason == "not_processed"
    assert date.evidence[0].raw_value == "1985:06:07 08:09:10"
    assert date.evidence[0].raw_offset == "+08:00"
    assert store.photos_in_year("owner", 1985) == []
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT granted FROM photo_time_consents").fetchone() == (0,)
    app.dependency_overrides[require_user_context] = lambda: UserContext("other", "other", "", "")
    for variant in ("original", "thumbnail", "date"):
        assert client.get(f"/photos/{photo_id}/{variant}").status_code == 404


def test_idempotent_upload_conflict_and_owner_scoping(setup):
    client, store, app = setup
    raw = jpeg()
    first = client.post("/photos/uploads/key", content=raw).json()
    repeat = client.post("/photos/uploads/key", content=raw)
    assert repeat.status_code == 201
    assert repeat.json() == {**first, "created": False}
    assert client.post("/photos/uploads/key", content=jpeg(date="1990:01:01 00:00:00")).status_code == 409
    app.dependency_overrides[require_user_context] = lambda: UserContext("other", "other", "", "")
    other = client.post("/photos/uploads/key", content=raw).json()
    assert other["photo_id"] != first["photo_id"]
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT count(*) FROM photo_media").fetchone() == (2,)


@pytest.mark.parametrize("raw", [b"", b"not an image", jpeg()[:100]])
def test_invalid_image_creates_no_records(setup, raw):
    client, store, _ = setup
    assert client.post("/photos/uploads/bad", content=raw).status_code == 422
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT count(*) FROM photo_date_states").fetchone() == (0,)


def test_size_pixel_and_animation_limits(setup, monkeypatch):
    from src.apps.photos import media

    client, _, _ = setup
    monkeypatch.setattr(media, "MAX_UPLOAD_BYTES", 100)
    assert client.post("/photos/uploads/large", content=jpeg()).status_code == 413
    monkeypatch.setattr(media, "MAX_UPLOAD_BYTES", 10 * 1024 * 1024)
    monkeypatch.setattr(media, "MAX_PIXELS", 100)
    assert client.post("/photos/uploads/pixels", content=jpeg()).status_code == 413
    monkeypatch.setattr(media, "MAX_PIXELS", 20_000_000)
    output = BytesIO()
    Image.new("RGB", (4, 4), "red").save(
        output, "PNG", save_all=True, append_images=[Image.new("RGB", (4, 4), "blue")],
    )
    assert client.post("/photos/uploads/animated", content=output.getvalue()).status_code == 422


def test_failed_media_commit_rolls_back_photo_registration(setup):
    client, store, _ = setup
    with sqlite3.connect(store.path) as connection:
        connection.execute("""CREATE TRIGGER reject_media BEFORE INSERT ON photo_media
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END""")
    assert client.post("/photos/uploads/fail", content=jpeg()).status_code == 503
    with sqlite3.connect(store.path) as connection:
        for table in ("photo_media", "photo_date_states", "photo_date_history", "photo_time_consents"):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)


@pytest.mark.parametrize("format,mime", [("PNG", "image/png"), ("WEBP", "image/webp")])
def test_supported_images_without_exif_keep_unknown_capture_date(setup, format, mime):
    client, store, _ = setup
    output = BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, format)
    raw = output.getvalue()
    response = client.post("/photos/uploads/no-exif", content=raw)
    assert response.status_code == 201
    photo_id = response.json()["photo_id"]
    annotation = store.read("owner", photo_id)
    assert annotation.date is None
    assert annotation.evidence[0].raw_value is None
    original = client.get(f"/photos/{photo_id}/original")
    assert original.headers["content-type"] == mime
    assert original.content == raw
    # New process/store object can read media; no in-memory-only upload state.
    reopened = DateStore(store.path, initialize=False)
    assert reopened.media("owner", photo_id, thumbnail=False) == (raw, mime)


def test_unsupported_static_format_and_path_like_upload_key_are_rejected(setup):
    client, _, _ = setup
    output = BytesIO()
    Image.new("RGB", (8, 8)).save(output, "GIF")
    assert client.post("/photos/uploads/gif", content=output.getvalue()).status_code == 422
    assert client.post("/photos/uploads/key.with.dots", content=jpeg()).status_code == 422
