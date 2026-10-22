"""Exercise real local transactions, not a mock repository."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from src.apps.photos.date_store import (
    DateStore, PhotoNotAvailable, TimeConsentRequired, OperationConflict,
)
from src.apps.photos.dates import (
    DateRevisionConflict, ExifCaptureTime, PhotoTimeEvidence,
)


@pytest.fixture
def store(tmp_path):
    instance = DateStore(tmp_path / "photos.db")
    instance.register_photo("owner", "batch", "photo", PhotoTimeEvidence())
    instance.set_time_consent("owner", "batch", granted=True)
    return instance


def edit(store, **kwargs):
    args = dict(owner="owner", photo_id="photo", actor="user", operation_id="op1",
                expected_revision=1, consent_version=1, value="1985", precision="year")
    args.update(kwargs)
    return store.correct(**args)


def restore(store, **kwargs):
    args = dict(owner="owner", photo_id="photo", actor="user", operation_id="restore",
                expected_revision=2, consent_version=1, target_revision=1)
    args.update(kwargs)
    return store.restore(**args)


def test_commit_reopen_history_and_year_projection(store):
    edit(store)
    reopened = DateStore(store.path)
    assert reopened.read("owner", "photo").date.value == "1985"
    assert reopened.photos_in_year("owner", 1985) == ["photo"]
    history = reopened.history("owner", "photo")
    assert len(history) == 2
    assert history[-1].before.date is None
    assert history[-1].after.date.precision == "year"
    assert history[-1].actor == "user"
    assert history[-1].created_at.utcoffset().total_seconds() == 0


def test_restore_unknown_appends_revision_and_removes_year(store):
    edit(store)
    result = restore(store)
    assert result.revision == 3
    assert result.reason == "missing"
    assert store.photos_in_year("owner", 1985) == []
    assert len(store.history("owner", "photo")) == 3
    assert store.history("owner", "photo")[-1].restored_from_revision == 1
    with pytest.raises(DateRevisionConflict):
        edit(store, operation_id="stale", expected_revision=2)


def test_restore_user_month_precision_after_further_correction(store):
    edit(store, value="1985-06", precision="month")
    edit(store, operation_id="op2", expected_revision=2, value="1990")
    result = restore(store, expected_revision=3, target_revision=2)
    assert result.date.value == "1985-06"
    assert result.date.precision == "month"
    assert result.source == "user"
    assert result.revision == 4
    assert store.photos_in_year("owner", 1990) == []
    assert store.photos_in_year("owner", 1985) == ["photo"]


@pytest.mark.parametrize("method", ["read", "history", "correct", "restore"])
def test_cross_owner_reads_and_writes_are_denied(store, method):
    with pytest.raises(PhotoNotAvailable):
        if method == "correct":
            edit(store, owner="other")
        elif method == "restore":
            restore(store, owner="other")
        else:
            getattr(store, method)("other", "photo")
    assert store.photos_in_year("other", 1985) == []
    assert store.read("owner", "photo").revision == 1


def test_revoke_blocks_writes_and_old_grant_version_cannot_be_reused(store):
    assert store.set_time_consent("owner", "batch", granted=False) == 2
    with pytest.raises(TimeConsentRequired):
        edit(store)
    assert store.set_time_consent("owner", "batch", granted=True) == 3
    with pytest.raises(TimeConsentRequired):
        edit(store)
    assert edit(store, consent_version=3).revision == 2
    store.set_time_consent("owner", "batch", granted=False)
    with pytest.raises(TimeConsentRequired):
        restore(store, consent_version=3)
    assert store.read("owner", "photo").revision == 2


def test_upload_registration_does_not_grant_consent(tmp_path):
    store = DateStore(tmp_path / "photos.db")
    store.register_photo("owner", "batch", "photo", PhotoTimeEvidence())
    with pytest.raises(TimeConsentRequired):
        edit(store)
    assert store.read("owner", "photo").reason == "not_processed"


def test_idempotent_retry_and_reused_operation_payload_conflict(store):
    first = edit(store)
    assert edit(store) == first
    with pytest.raises(OperationConflict):
        edit(store, value="1999")
    assert len(store.history("owner", "photo")) == 2
    restored = restore(store)
    assert restore(store) == restored
    assert len(store.history("owner", "photo")) == 3


def test_parallel_corrections_only_one_commits(store):
    ready = Barrier(2)

    def write(number):
        ready.wait(timeout=5)
        try:
            return edit(store, operation_id=f"parallel{number}", value=str(1980 + number))
        except DateRevisionConflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, [1, 2]))
    assert sum(result is not None for result in results) == 1
    assert store.read("owner", "photo").revision == 2
    assert len(store.history("owner", "photo")) == 2


def test_history_insert_failure_rolls_back_annotation_and_year(store):
    with sqlite3.connect(store.path) as connection:
        connection.execute("""CREATE TRIGGER fail_history BEFORE INSERT ON photo_date_history
            WHEN NEW.kind = 'correct' BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
    with pytest.raises(sqlite3.IntegrityError):
        edit(store)
    assert store.read("owner", "photo").revision == 1
    assert store.photos_in_year("owner", 1985) == []
    assert len(store.history("owner", "photo")) == 1


def test_initial_exif_is_saved_but_not_applied_without_organization(store):
    inputs = PhotoTimeEvidence(original_capture_times=(ExifCaptureTime(
        source_ref="original/exif", raw_value="1980:05:06 07:08:09",
    ),))
    store.register_photo("owner", "batch", "second", inputs)
    assert store.read("owner", "second").date is None
    assert store.photos_in_year("owner", 1980) == []
    # Explicit authorized restoration of the initial automatic state parses
    # saved evidence afresh instead of trusting a serialized date.
    result = restore(store, photo_id="second", expected_revision=1)
    assert result.album_year == 1980
    assert result.source == "exif"


def test_missing_history_target_and_invalid_date_leave_no_partial_write(store):
    with pytest.raises(PhotoNotAvailable):
        restore(store, expected_revision=1, target_revision=999)
    with pytest.raises(ValueError):
        edit(store, value="1985-99", precision="month")
    assert store.read("owner", "photo").revision == 1
    assert len(store.history("owner", "photo")) == 1


def test_concurrent_revoke_and_edit_have_a_serial_transaction_order(store):
    ready = Barrier(2)

    def revoke():
        ready.wait(timeout=5)
        return store.set_time_consent("owner", "batch", granted=False)

    def write():
        ready.wait(timeout=5)
        try:
            return edit(store)
        except TimeConsentRequired:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        revocation = pool.submit(revoke)
        correction = pool.submit(write)
        assert revocation.result() == 2
        result = correction.result()
    assert store.read("owner", "photo").revision == (2 if result else 1)
    assert len(store.history("owner", "photo")) == (2 if result else 1)
    with pytest.raises(TimeConsentRequired):
        edit(store, operation_id="after-revoke", expected_revision=2 if result else 1)
    with sqlite3.connect(store.path) as connection:
        rows = connection.execute(
            "SELECT version, granted FROM photo_time_consent_history ORDER BY version"
        ).fetchall()
    assert rows == [(1, 1), (2, 0)]
