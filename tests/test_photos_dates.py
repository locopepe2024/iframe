"""Date rules only: no uploaded files, authorization, database, or model calls."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from src.apps.photos.dates import (
    DateAnnotation,
    DateRevisionConflict,
    ExifCaptureTime,
    FileTimeEvidence,
    PhotoDate,
    PhotoTimeEvidence,
    correct_date,
    resolve_exif_dates,
    resolve_photo_date,
)


def evidence(value="1980:05:06 07:08:09", offset=None, source="image/exif/original"):
    return ExifCaptureTime(source_ref=source, raw_value=value, raw_offset=offset)


@pytest.mark.parametrize("records", [[], [evidence(None)], [evidence(" \x00")]])
def test_missing_capture_date_remains_unknown(records):
    result = resolve_exif_dates(records)
    assert result.status == "pending_confirmation"
    assert result.reason == "missing"
    assert result.date is None
    assert result.album_year is None
    assert result.evidence == tuple(records)


def test_valid_exif_keeps_local_wall_time_without_inventing_timezone():
    raw = evidence(" 1980:05:06 07:08:09\x00")
    result = resolve_exif_dates([raw])
    assert result.status == "parsed"
    assert result.date == PhotoDate(value="1980-05-06T07:08:09", precision="second")
    assert result.date.utc_offset is None
    assert result.album_year == 1980
    assert result.evidence == (raw,)


@pytest.mark.parametrize("offset", ["+08:00", "-05:30", "+00:00"])
def test_explicit_offset_is_retained_without_shifting_album_year(offset):
    result = resolve_exif_dates([evidence("2000:01:01 00:15:00", offset)])
    assert result.date.value == "2000-01-01T00:15:00"
    assert result.date.utc_offset == offset
    assert result.album_year == 2000


@pytest.mark.parametrize("value", [
    "0000:00:00 00:00:00", "1900:02:29 12:00:00", "2024:02:30 12:00:00",
    "2024:13:01 00:00:00", "2024:01:01 24:00:00", "2024:01:01 00:00:60",
    "1980", "1980-05-06T07:08:09", "today", "１９８０:05:06 07:08:09",
])
def test_invalid_exif_becomes_pending_without_losing_evidence(value):
    raw = evidence(value)
    result = resolve_exif_dates([raw])
    assert result.status == "pending_confirmation"
    assert result.reason == "invalid"
    assert result.date is None
    assert result.evidence == (raw,)


@pytest.mark.parametrize("offset", ["+24:00", "+08:60", "UTC", "Z", "0800", "+8:00"])
def test_invalid_explicit_offset_does_not_become_a_valid_naive_date(offset):
    result = resolve_exif_dates([evidence(offset=offset)])
    assert result.reason == "invalid"
    assert result.date is None


@pytest.mark.parametrize("other", [
    evidence("1981:05:06 07:08:09", source="second/original"),
    evidence(offset="+08:00", source="second/original"),
])
def test_conflicting_sources_remain_pending(other):
    records = [evidence(), other, evidence()]
    result = resolve_exif_dates(records)
    assert result.reason == "conflict"
    assert result.date is None
    assert result.evidence == tuple(records)


def test_agreeing_sources_are_resolved_and_blank_sources_do_not_vote():
    result = resolve_exif_dates([evidence(), evidence(None), evidence(source="copy/original")])
    assert result.status == "parsed"
    assert result.album_year == 1980
    assert len(result.evidence) == 3


def test_valid_source_does_not_hide_an_invalid_source():
    result = resolve_exif_dates([evidence(), evidence("invalid", source="bad/original")])
    assert result.reason == "invalid"
    assert result.date is None


@pytest.mark.parametrize(("value", "precision"), [
    ("1980", "year"), ("1980-05", "month"), ("2000-02-29", "day"),
])
def test_user_can_confirm_partial_dates_and_keep_original_evidence(value, precision):
    initial = resolve_exif_dates([evidence("bad value")])
    revised = correct_date(initial, value=value, precision=precision, expected_revision=1)
    assert revised.date.value == value
    assert revised.date.precision == precision
    assert revised.date.utc_offset is None
    assert revised.album_year == int(value[:4])
    assert revised.status == "confirmed"
    assert revised.source == "user"
    assert revised.reason is None
    assert revised.revision == 2
    assert revised.evidence == initial.evidence
    assert initial.date is None
    assert initial.revision == 1


@pytest.mark.parametrize(("value", "precision"), [
    ("1980", "month"), ("1980-05", "year"), ("1980-05-01", "month"),
    ("0000", "year"), ("1980-00", "month"), ("1980-13", "month"),
    ("1900-02-29", "day"), ("2024-02-30", "day"), ("80", "year"),
    ("1980年", "year"), ("１９８０", "year"), ("1980-5", "month"),
    ("1980-05-06T07:08:09", "second"),
])
def test_invalid_or_mismatched_manual_date_is_rejected(value, precision):
    with pytest.raises(ValueError):
        correct_date(resolve_exif_dates([]), value=value, precision=precision, expected_revision=1)


def test_stale_correction_fails_and_exif_rerun_never_overwrites_user_confirmation():
    initial = resolve_exif_dates([evidence()])
    revised = correct_date(initial, value="1975", precision="year", expected_revision=1)
    with pytest.raises(DateRevisionConflict):
        correct_date(revised, value="2001", precision="year", expected_revision=1)
    assert resolve_exif_dates([evidence("2020:01:01 00:00:00")], current=revised) == revised


def test_exif_reparse_is_idempotent_and_advances_revision_when_evidence_changes():
    first = resolve_exif_dates([evidence()])
    assert resolve_exif_dates([evidence()], current=first) == first
    updated = resolve_exif_dates([evidence("2000:02:29 12:00:00")], current=first)
    assert updated.revision == first.revision + 1
    assert updated.date.value == "2000-02-29T12:00:00"
    assert first.album_year == 1980


def test_annotation_roundtrips_and_rejects_inconsistent_serialized_values():
    annotation = correct_date(resolve_exif_dates([evidence()]), value="1980", precision="year", expected_revision=1)
    assert DateAnnotation.model_validate_json(annotation.model_dump_json()) == annotation
    with pytest.raises(ValidationError):
        DateAnnotation.model_validate({**annotation.model_dump(), "status": "pending_confirmation"})
    with pytest.raises(ValidationError):
        PhotoDate(value="1980", precision="year", utc_offset="+08:00")
    with pytest.raises(ValidationError):
        annotation.revision = 3


def test_file_and_upload_times_are_preserved_without_becoming_capture_dates():
    files = FileTimeEvidence(
        source_ref="file/stat", created_at=datetime(2020, 1, 2, tzinfo=timezone.utc),
        modified_at=datetime(2021, 3, 4, tzinfo=timezone.utc),
    )
    inputs = PhotoTimeEvidence(
        file_times=(files,), uploaded_at=datetime(2026, 10, 22, tzinfo=timezone.utc),
    )
    assert PhotoTimeEvidence.model_validate_json(inputs.model_dump_json()) == inputs
    annotation = resolve_photo_date(inputs)
    assert annotation.reason == "missing"
    assert annotation.album_year is None
    confirmed = correct_date(annotation, value="1985", precision="year", expected_revision=1)
    assert resolve_photo_date(inputs, current=confirmed) == confirmed
    assert confirmed.date.value == "1985"
    assert inputs.file_times == (files,)


def test_original_capture_date_wins_over_newer_file_and_upload_dates():
    inputs = PhotoTimeEvidence(
        original_capture_times=(evidence(),),
        file_times=(FileTimeEvidence(
            source_ref="external/file", modified_at=datetime(2026, 10, 22),
        ),),
        uploaded_at=datetime(2026, 10, 22),
    )
    assert resolve_photo_date(inputs).album_year == 1980


@pytest.mark.parametrize("changes", [
    {"source": "user"}, {"date": None}, {"reason": "invalid"},
    {"revision": 0}, {"unexpected": True},
])
def test_deserialized_annotations_reject_invalid_state(changes):
    annotation = resolve_exif_dates([evidence()])
    with pytest.raises(ValidationError):
        DateAnnotation.model_validate({**annotation.model_dump(), **changes})
