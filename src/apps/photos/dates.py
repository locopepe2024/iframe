"""Capture-date rules. File/upload times are evidence, never capture-date input.

These immutable snapshots do not provide storage or transactional concurrency.
"""

import re
from datetime import datetime
from typing import Iterable, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


Precision = Literal["year", "month", "day", "second"]
ManualPrecision = Literal["year", "month", "day"]
_PATTERNS = {
    "year": r"[0-9]{4}",
    "month": r"[0-9]{4}-[0-9]{2}",
    "day": r"[0-9]{4}-[0-9]{2}-[0-9]{2}",
    "second": r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}",
}
_FORMATS = {
    "year": "%Y", "month": "%Y-%m", "day": "%Y-%m-%d",
    "second": "%Y-%m-%dT%H:%M:%S",
}


class Snapshot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)


def _valid_offset(value: str) -> bool:
    return bool(
        re.fullmatch(r"[+-][0-9]{2}:[0-9]{2}", value)
        and int(value[1:3]) < 24
        and int(value[4:]) < 60
    )


class ExifCaptureTime(Snapshot):
    source_ref: str = Field(min_length=1)
    raw_value: str | None
    raw_offset: str | None = None


class FileTimeEvidence(Snapshot):
    """Auxiliary file times; neither is asserted to be the capture date."""

    source_ref: str = Field(min_length=1)
    created_at: datetime | None = None
    modified_at: datetime | None = None


class PhotoTimeEvidence(Snapshot):
    """Keep fallback/display times distinct from original capture tags.

    Extraction adapters must classify provenance before constructing this
    input. An external service's unified date is not necessarily EXIF.
    """

    original_capture_times: tuple[ExifCaptureTime, ...] = ()
    file_times: tuple[FileTimeEvidence, ...] = ()
    uploaded_at: datetime | None = None


class PhotoDate(Snapshot):
    value: str
    precision: Precision
    utc_offset: str | None = None

    @model_validator(mode="after")
    def validate_date(self) -> Self:
        if not re.fullmatch(_PATTERNS[self.precision], self.value):
            raise ValueError("Date value must exactly match its precision")
        # strptime validates the calendar; its temporary default month/day is
        # never stored or returned as part of a partial date.
        datetime.strptime(self.value, _FORMATS[self.precision])
        if self.utc_offset is not None:
            if self.precision != "second" or not _valid_offset(self.utc_offset):
                raise ValueError("Only second-precision dates accept explicit ±HH:MM offsets")
        return self


class DateAnnotation(Snapshot):
    date: PhotoDate | None
    status: Literal["parsed", "confirmed", "pending_confirmation"]
    reason: Literal["missing", "invalid", "conflict", "not_processed"] | None = None
    source: Literal["exif", "user", "none"]
    revision: int = Field(ge=1)
    evidence: tuple[ExifCaptureTime, ...] = ()

    @model_validator(mode="after")
    def validate_state(self) -> Self:
        if self.status == "pending_confirmation":
            if self.date is not None or self.reason is None or self.source != "none":
                raise ValueError("Pending dates need a reason and no capture-date value/source")
        elif self.date is None or self.reason is not None:
            raise ValueError("Resolved dates need a date and no pending reason")
        elif self.status == "confirmed" and self.source != "user":
            raise ValueError("Confirmed dates must come from the user")
        elif self.status == "parsed" and (
            self.source != "exif" or self.date.precision != "second"
        ):
            raise ValueError("Parsed dates must come from second-precision EXIF")
        return self

    @property
    def album_year(self) -> int | None:
        return int(self.date.value[:4]) if self.date else None


class DateRevisionConflict(ValueError):
    """The caller's snapshot is stale; storage must also enforce this atomically."""


def resolve_photo_date(
    evidence: PhotoTimeEvidence, *, current: DateAnnotation | None = None,
) -> DateAnnotation:
    """Resolve capture date while deliberately excluding auxiliary file times."""
    return resolve_exif_dates(evidence.original_capture_times, current=current)


def _trim(value: str | None) -> str:
    return value.strip(" \t\r\n\v\f\x00") if value else ""


def resolve_exif_dates(
    records: Iterable[ExifCaptureTime], *, current: DateAnnotation | None = None,
) -> DateAnnotation:
    """Resolve original capture tags only, keeping unknown dates explicitly empty.

    Confirmed snapshots are unchanged. New evidence should be kept by the
    caller's evidence store, independently of the confirmed annotation.
    """
    if current is not None and current.status == "confirmed":
        return current
    evidence = tuple(records)
    candidates: set[PhotoDate] = set()
    invalid = False
    for record in evidence:
        value, offset = _trim(record.raw_value), _trim(record.raw_offset)
        if not value:
            continue
        try:
            if not re.fullmatch(
                r"[0-9]{4}:[0-9]{2}:[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}", value
            ):
                raise ValueError("Invalid EXIF capture date format")
            candidates.add(PhotoDate(
                value=value[:10].replace(":", "-") + "T" + value[11:],
                precision="second", utc_offset=offset or None,
            ))
        except ValueError:
            invalid = True
    reason = None
    if invalid:
        reason = "invalid"
    elif len(candidates) > 1:
        reason = "conflict"
    elif not candidates:
        reason = "missing"
    result = DateAnnotation(
        date=next(iter(candidates)) if reason is None else None,
        status="pending_confirmation" if reason else "parsed",
        source="none" if reason else "exif", reason=reason,
        revision=current.revision if current else 1, evidence=evidence,
    )
    if current is not None and result != current:
        return DateAnnotation(**{**result.model_dump(), "revision": current.revision + 1})
    return result


def correct_date(
    current: DateAnnotation, *, value: str, precision: ManualPrecision, expected_revision: int,
) -> DateAnnotation:
    if expected_revision != current.revision:
        raise DateRevisionConflict("Date changed; reload before confirming")
    if precision not in ("year", "month", "day"):
        raise ValueError("Manual dates accept year, month, or day precision")
    return DateAnnotation(
        date=PhotoDate(value=value, precision=precision), status="confirmed",
        source="user", revision=current.revision + 1, evidence=current.evidence,
    )
