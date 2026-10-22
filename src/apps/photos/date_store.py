"""Explicit local SQLite prototype for photo date edits; no default or fallback DB.

Callers must supply authenticated owner/actor identities. No public API or
background jobs are registered here. Each photo belongs to one batch in this
slice; batch undo and shared ownership are deliberately not implemented.
"""

import json
import hashlib
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import Field

from .dates import (
    DateAnnotation, DateRevisionConflict, ManualPrecision, PhotoTimeEvidence,
    Snapshot, correct_date, resolve_photo_date,
)
from .media import PreparedPhoto


class PhotoNotAvailable(LookupError):
    """Missing and foreign-owner resources share one error."""


class TimeConsentRequired(PermissionError):
    pass


class OperationConflict(ValueError):
    pass


class DateChange(Snapshot):
    revision: int = Field(ge=1)
    before: DateAnnotation | None
    after: DateAnnotation
    actor: str
    created_at: datetime
    operation_id: str
    kind: Literal["register", "correct", "restore", "organize"]
    restored_from_revision: int | None = None


_SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_stories (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, revision INTEGER NOT NULL,
    operation_id TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner, photo_id, revision), UNIQUE(owner, photo_id, operation_id)
);
CREATE TABLE IF NOT EXISTS photo_description_reviews (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, revision INTEGER NOT NULL,
    operation_id TEXT NOT NULL, actor TEXT NOT NULL, description TEXT NOT NULL,
    analysis_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(owner, photo_id, revision), UNIQUE(owner, photo_id, operation_id)
);
CREATE TABLE IF NOT EXISTS photo_content_analyses (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, actor TEXT NOT NULL,
    disclosure_version TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(owner, photo_id)
);
CREATE TABLE IF NOT EXISTS photo_time_consents (
    owner TEXT NOT NULL, batch_id TEXT NOT NULL,
    granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
    version INTEGER NOT NULL CHECK(version >= 0),
    PRIMARY KEY(owner, batch_id)
);
CREATE TABLE IF NOT EXISTS photo_date_states (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, batch_id TEXT NOT NULL,
    evidence TEXT NOT NULL, annotation TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 1), album_year INTEGER,
    PRIMARY KEY(owner, photo_id),
    FOREIGN KEY(owner, batch_id) REFERENCES photo_time_consents(owner, batch_id)
);
CREATE TABLE IF NOT EXISTS photo_time_consent_history (
    owner TEXT NOT NULL, batch_id TEXT NOT NULL, version INTEGER NOT NULL,
    granted INTEGER NOT NULL CHECK(granted IN (0, 1)),
    actor TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(owner, batch_id, version),
    FOREIGN KEY(owner, batch_id) REFERENCES photo_time_consents(owner, batch_id)
);
CREATE INDEX IF NOT EXISTS photo_date_year ON photo_date_states(owner, album_year);
CREATE TABLE IF NOT EXISTS photo_media (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, upload_id TEXT NOT NULL,
    sha256 TEXT NOT NULL, media_type TEXT NOT NULL,
    original BLOB NOT NULL, thumbnail BLOB NOT NULL,
    PRIMARY KEY(owner, photo_id), UNIQUE(owner, upload_id),
    FOREIGN KEY(owner, photo_id) REFERENCES photo_date_states(owner, photo_id)
);
CREATE TABLE IF NOT EXISTS photo_date_history (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, revision INTEGER NOT NULL,
    operation_id TEXT NOT NULL, request TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('register', 'correct', 'restore', 'organize')),
    change_json TEXT NOT NULL,
    PRIMARY KEY(owner, photo_id, revision),
    UNIQUE(owner, photo_id, operation_id),
    FOREIGN KEY(owner, photo_id) REFERENCES photo_date_states(owner, photo_id)
);
CREATE TABLE IF NOT EXISTS photo_time_questions (
    owner TEXT NOT NULL, batch_id TEXT NOT NULL, question_id TEXT NOT NULL,
    consent_version INTEGER NOT NULL, expires_at TEXT NOT NULL,
    question_version INTEGER NOT NULL, processing_location TEXT NOT NULL,
    question_text TEXT NOT NULL,
    PRIMARY KEY(owner, batch_id), UNIQUE(question_id),
    FOREIGN KEY(owner, batch_id) REFERENCES photo_time_consents(owner, batch_id)
);
CREATE TABLE IF NOT EXISTS photo_time_question_answers (
    owner TEXT NOT NULL, batch_id TEXT NOT NULL, question_id TEXT NOT NULL,
    granted INTEGER NOT NULL, consent_version INTEGER NOT NULL,
    actor TEXT NOT NULL, method TEXT NOT NULL, processing_location TEXT NOT NULL,
    question_version INTEGER NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(owner, question_id),
    FOREIGN KEY(owner, batch_id) REFERENCES photo_time_consents(owner, batch_id)
);
CREATE TABLE IF NOT EXISTS photo_date_noop_receipts (
    owner TEXT NOT NULL, photo_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    request TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(owner, photo_id, operation_id),
    FOREIGN KEY(owner, photo_id) REFERENCES photo_date_states(owner, photo_id)
);
CREATE TABLE IF NOT EXISTS photo_time_revocations (
    owner TEXT NOT NULL, batch_id TEXT NOT NULL, previous_version INTEGER NOT NULL,
    actor TEXT NOT NULL, result_version INTEGER NOT NULL,
    PRIMARY KEY(owner, batch_id, previous_version),
    FOREIGN KEY(owner, batch_id) REFERENCES photo_time_consents(owner, batch_id)
);
"""


class DateStore:
    def __init__(self, path: str | Path, *, initialize: bool = True):
        if not str(path) or str(path) == ":memory:":
            raise ValueError("An explicit persistent SQLite file is required")
        self.path = Path(path)
        self._existing_only = not initialize
        # Parent must already exist: a typo must not silently choose new storage.
        if initialize:
            with self._connection() as connection:
                connection.executescript(_SCHEMA)
            # Explicit local migration: expand the old history CHECK while
            # retaining every row. HTTP constructs initialize=False stores.
            with self._connection(write=True) as connection:
                definition = connection.execute(
                    "SELECT sql FROM sqlite_master WHERE name = 'photo_date_history'"
                ).fetchone()[0]
                if "'organize'" not in definition:
                    connection.execute("ALTER TABLE photo_date_history RENAME TO old_date_history")
                    start = _SCHEMA.index("CREATE TABLE IF NOT EXISTS photo_date_history")
                    end = _SCHEMA.index(";", start) + 1
                    connection.execute(_SCHEMA[start:end])
                    connection.execute("INSERT INTO photo_date_history SELECT * FROM old_date_history")
                    connection.execute("DROP TABLE old_date_history")

    @contextmanager
    def _connection(self, *, write=False):
        connection = (
            sqlite3.connect(self.path.resolve().as_uri() + "?mode=rw", uri=True, timeout=5)
            if self._existing_only else sqlite3.connect(self.path, timeout=5)
        )
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _photo(connection, owner, photo_id):
        row = connection.execute(
            "SELECT * FROM photo_date_states WHERE owner = ? AND photo_id = ?",
            (owner, photo_id),
        ).fetchone()
        if row is None:
            raise PhotoNotAvailable("Photo is not available")
        return row

    def register_photo(self, owner: str, batch_id: str, photo_id: str,
                       evidence: PhotoTimeEvidence) -> None:
        if not all((owner, batch_id, photo_id)):
            raise ValueError("Owner, batch and photo identifiers are required")
        with self._connection(write=True) as connection:
            self._register(connection, owner, batch_id, photo_id, evidence)

    def _register(self, connection, owner, batch_id, photo_id, evidence):
        # Registration saves evidence without starting date organization.
        initial = DateAnnotation(
            date=None, status="pending_confirmation", reason="not_processed",
            source="none", revision=1, evidence=evidence.original_capture_times,
        )
        connection.execute(
            "INSERT OR IGNORE INTO photo_time_consents VALUES (?, ?, 0, 0)",
            (owner, batch_id),
        )
        connection.execute(
            "INSERT INTO photo_date_states VALUES (?, ?, ?, ?, ?, 1, NULL)",
            (owner, photo_id, batch_id, evidence.model_dump_json(), initial.model_dump_json()),
        )
        self._record(connection, owner, photo_id, None, initial, actor=owner,
                     operation_id="register", request="{}", kind="register")

    def upload(self, owner: str, upload_id: str, prepared: PreparedPhoto) -> dict:
        digest = hashlib.sha256(prepared.original).hexdigest()
        with self._connection(write=True) as connection:
            previous = connection.execute(
                "SELECT m.photo_id, m.sha256, s.batch_id FROM photo_media m "
                "JOIN photo_date_states s ON s.owner = m.owner AND s.photo_id = m.photo_id "
                "WHERE m.owner = ? AND m.upload_id = ?", (owner, upload_id),
            ).fetchone()
            if previous:
                if previous["sha256"] != digest:
                    raise OperationConflict("Upload ID was used for different bytes")
                return {"photo_id": previous["photo_id"], "batch_id": previous["batch_id"],
                        "created": False}
            photo_id, batch_id = str(uuid.uuid4()), str(uuid.uuid4())
            self._register(connection, owner, batch_id, photo_id, prepared.evidence)
            connection.execute(
                "INSERT INTO photo_media VALUES (?, ?, ?, ?, ?, ?, ?)",
                (owner, photo_id, upload_id, digest, prepared.media_type,
                 prepared.original, prepared.thumbnail),
            )
            return {"photo_id": photo_id, "batch_id": batch_id, "created": True}

    def media(self, owner: str, photo_id: str, *, thumbnail: bool) -> tuple[bytes, str]:
        with self._connection() as connection:
            column = "thumbnail" if thumbnail else "original"
            row = connection.execute(
                f"SELECT {column} AS content, media_type FROM photo_media "
                "WHERE owner = ? AND photo_id = ?", (owner, photo_id),
            ).fetchone()
            if row is None:
                raise PhotoNotAvailable("Photo is not available")
            return row["content"], "image/webp" if thumbnail else row["media_type"]

    def analysis(self, owner: str, photo_id: str):
        from .analysis import PhotoAnalysis
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            row = connection.execute("SELECT result FROM photo_content_analyses WHERE owner=? AND photo_id=?",
                                     (owner, photo_id)).fetchone()
            return PhotoAnalysis.model_validate_json(row["result"]) if row else None

    def story(self, owner, photo_id):
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            row = connection.execute(
                "SELECT revision,text,actor,created_at FROM photo_stories WHERE owner=? AND photo_id=? ORDER BY revision DESC LIMIT 1",
                (owner, photo_id)).fetchone()
            return dict(row) if row else None

    def story_history(self, owner, photo_id, after=0, limit=20):
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            rows = connection.execute(
                "SELECT revision,text,actor,created_at FROM photo_stories WHERE owner=? AND photo_id=? AND revision>? ORDER BY revision LIMIT ?",
                (owner, photo_id, after, limit)).fetchall()
            return [dict(row) for row in rows]

    def save_story(self, owner, photo_id, actor, *, text, expected_revision, operation_id):
        # Stories are user narratives, never evidence for date/person annotations.
        with self._connection(write=True) as connection:
            self._photo(connection, owner, photo_id)
            existing = connection.execute(
                "SELECT * FROM photo_stories WHERE owner=? AND photo_id=? AND operation_id=?",
                (owner, photo_id, operation_id)).fetchone()
            if existing:
                if existing["text"] != text or existing["revision"] != expected_revision + 1:
                    raise OperationConflict("Story operation conflicts")
                return {key: existing[key] for key in ("revision", "text", "actor", "created_at")}
            current = connection.execute(
                "SELECT COALESCE(MAX(revision),0) FROM photo_stories WHERE owner=? AND photo_id=?",
                (owner, photo_id)).fetchone()[0]
            if current != expected_revision:
                raise OperationConflict("Story changed")
            created_at = datetime.now(timezone.utc).isoformat()
            connection.execute("INSERT INTO photo_stories VALUES (?,?,?,?,?,?,?)",
                               (owner, photo_id, current + 1, operation_id, actor, text, created_at))
            return dict(revision=current + 1, text=text, actor=actor, created_at=created_at)

    def description_history(self, owner, photo_id, after=0, limit=20):
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            rows = connection.execute("SELECT revision,description,actor,created_at FROM photo_description_reviews WHERE owner=? AND photo_id=? AND revision>? ORDER BY revision LIMIT ?",
                                      (owner, photo_id, after, limit)).fetchall()
            return [dict(row) for row in rows]

    def description_review(self, owner, photo_id):
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            row = connection.execute("SELECT revision,description,actor,created_at FROM photo_description_reviews WHERE owner=? AND photo_id=? ORDER BY revision DESC LIMIT 1", (owner, photo_id)).fetchone()
            return dict(row) if row else None

    def confirm_description(self, owner, photo_id, actor, *, description, expected_revision, operation_id):
        from .analysis import PhotoAnalysis
        with self._connection(write=True) as connection:
            self._photo(connection, owner, photo_id)
            existing = connection.execute("SELECT * FROM photo_description_reviews WHERE owner=? AND photo_id=? AND operation_id=?", (owner, photo_id, operation_id)).fetchone()
            if existing:
                if existing["description"] != description or existing["revision"] != expected_revision + 1:
                    raise OperationConflict("Review operation conflicts")
                return {key: existing[key] for key in ("revision", "description", "actor", "created_at")}
            current = connection.execute("SELECT COALESCE(MAX(revision),0) FROM photo_description_reviews WHERE owner=? AND photo_id=?", (owner, photo_id)).fetchone()[0]
            if current != expected_revision:
                raise OperationConflict("Description changed")
            row = connection.execute("SELECT result FROM photo_content_analyses WHERE owner=? AND photo_id=?", (owner, photo_id)).fetchone()
            if not row:
                raise OperationConflict("Analyze photo before review")
            analysis = PhotoAnalysis.model_validate_json(row["result"])
            created_at = datetime.now(timezone.utc).isoformat()
            connection.execute("INSERT INTO photo_description_reviews VALUES (?,?,?,?,?,?,?,?)", (owner, photo_id, current + 1, operation_id, actor, description, analysis.image_sha256, created_at))
            return dict(revision=current + 1, description=description, actor=actor, created_at=created_at)

    def save_analysis(self, owner: str, photo_id: str, actor: str, result):
        from .analysis import PhotoAnalysis
        with self._connection(write=True) as connection:
            self._photo(connection, owner, photo_id)
            connection.execute("INSERT OR IGNORE INTO photo_content_analyses VALUES (?, ?, ?, ?, ?)",
                               (owner, photo_id, actor, "qwen-external-photo-v1", result.model_dump_json()))
            row = connection.execute("SELECT result FROM photo_content_analyses WHERE owner=? AND photo_id=?",
                                     (owner, photo_id)).fetchone()
            return PhotoAnalysis.model_validate_json(row["result"])

    def set_time_consent(self, owner: str, batch_id: str, *, granted: bool) -> int:
        """Trusted service boundary only; a UI checkbox alone is not authorization."""
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT version FROM photo_time_consents WHERE owner = ? AND batch_id = ?",
                (owner, batch_id),
            ).fetchone()
            if row is None:
                raise PhotoNotAvailable("Batch is not available")
            version = row["version"] + 1
            connection.execute(
                "UPDATE photo_time_consents SET granted = ?, version = ? "
                "WHERE owner = ? AND batch_id = ?",
                (int(granted), version, owner, batch_id),
            )
            connection.execute(
                "INSERT INTO photo_time_consent_history VALUES (?, ?, ?, ?, ?, ?)",
                (owner, batch_id, version, int(granted), owner,
                 datetime.now(timezone.utc).isoformat()),
            )
            return version

    def read(self, owner: str, photo_id: str) -> DateAnnotation:
        with self._connection() as connection:
            row = self._photo(connection, owner, photo_id)
            return DateAnnotation.model_validate_json(row["annotation"])

    def history(self, owner: str, photo_id: str, *, after_revision: int = 0,
                limit: int = 100) -> list[DateChange]:
        if after_revision < 0 or not 1 <= limit <= 101:
            raise ValueError("Invalid history page")
        with self._connection() as connection:
            self._photo(connection, owner, photo_id)
            rows = connection.execute(
                "SELECT change_json FROM photo_date_history "
                "WHERE owner = ? AND photo_id = ? AND revision > ? ORDER BY revision LIMIT ?",
                (owner, photo_id, after_revision, limit),
            ).fetchall()
            return [DateChange.model_validate_json(row[0]) for row in rows]

    def photos_in_year(self, owner: str, year: int) -> list[str]:
        with self._connection() as connection:
            return [row[0] for row in connection.execute(
                "SELECT photo_id FROM photo_date_states "
                "WHERE owner = ? AND album_year = ? ORDER BY photo_id", (owner, year),
            )]

    def correct(self, *, owner: str, photo_id: str, actor: str, operation_id: str,
                expected_revision: int, consent_version: int, value: str,
                precision: ManualPrecision) -> DateAnnotation:
        return self._change(
            owner, photo_id, actor, operation_id, expected_revision, consent_version,
            "correct", {"value": value, "precision": precision},
        )

    def restore(self, *, owner: str, photo_id: str, actor: str, operation_id: str,
                expected_revision: int, consent_version: int,
                target_revision: int) -> DateAnnotation:
        return self._change(
            owner, photo_id, actor, operation_id, expected_revision, consent_version,
            "restore", {"target_revision": target_revision},
        )

    def _change(self, owner, photo_id, actor, operation_id, expected_revision,
                consent_version, kind, payload):
        if not actor or not operation_id or operation_id == "register":
            raise ValueError("A non-reserved operation ID and actor are required")
        request = json.dumps({
            "kind": kind, "actor": actor, "expected_revision": expected_revision,
            "consent_version": consent_version, **payload,
        }, sort_keys=True)
        with self._connection(write=True) as connection:
            row = self._photo(connection, owner, photo_id)
            consent = connection.execute(
                "SELECT granted, version FROM photo_time_consents "
                "WHERE owner = ? AND batch_id = ?", (owner, row["batch_id"]),
            ).fetchone()
            if not consent["granted"] or consent["version"] != consent_version:
                raise TimeConsentRequired("Current batch time consent is required")
            previous = connection.execute(
                "SELECT request, change_json FROM photo_date_history "
                "WHERE owner = ? AND photo_id = ? AND operation_id = ?",
                (owner, photo_id, operation_id),
            ).fetchone()
            if previous:
                if previous["request"] != request:
                    raise OperationConflict("Operation ID was used for another request")
                return DateChange.model_validate_json(previous["change_json"]).after
            noop = connection.execute(
                "SELECT request, result FROM photo_date_noop_receipts "
                "WHERE owner = ? AND photo_id = ? AND operation_id = ?",
                (owner, photo_id, operation_id),
            ).fetchone()
            if noop:
                if noop["request"] != request:
                    raise OperationConflict("Operation ID was used for another request")
                return DateAnnotation.model_validate_json(noop["result"])
            current = DateAnnotation.model_validate_json(row["annotation"])
            if expected_revision != current.revision:
                raise DateRevisionConflict("Date changed; reload before confirming")
            target_revision = payload.get("target_revision")
            if kind == "correct":
                after = correct_date(current, expected_revision=expected_revision, **payload)
            elif kind == "organize":
                after = resolve_photo_date(
                    PhotoTimeEvidence.model_validate_json(row["evidence"]), current=current,
                )
                if after == current:
                    connection.execute(
                        "INSERT INTO photo_date_noop_receipts VALUES (?, ?, ?, ?, ?)",
                        (owner, photo_id, operation_id, request, current.model_dump_json()),
                    )
                    return current
            else:
                target = connection.execute(
                    "SELECT change_json FROM photo_date_history "
                    "WHERE owner = ? AND photo_id = ? AND revision = ?",
                    (owner, photo_id, target_revision),
                ).fetchone()
                if target is None:
                    raise PhotoNotAvailable("History version is not available")
                saved = DateChange.model_validate_json(target[0]).after
                if saved.status == "confirmed":
                    restored = saved
                else:
                    inputs = PhotoTimeEvidence.model_validate_json(row["evidence"])
                    restored = resolve_photo_date(inputs)
                after = DateAnnotation(**{
                    **restored.model_dump(), "revision": current.revision + 1,
                })
            written = connection.execute(
                "UPDATE photo_date_states SET annotation = ?, revision = ?, album_year = ? "
                "WHERE owner = ? AND photo_id = ? AND revision = ?",
                (after.model_dump_json(), after.revision, after.album_year,
                 owner, photo_id, expected_revision),
            )
            if written.rowcount != 1:
                raise DateRevisionConflict("Date changed; reload before confirming")
            self._record(
                connection, owner, photo_id, current, after, actor=actor,
                operation_id=operation_id, request=request, kind=kind,
                restored_from_revision=target_revision,
            )
            return after

    @staticmethod
    def _record(connection, owner, photo_id, before, after, *, actor, operation_id,
                request, kind, restored_from_revision=None):
        change = DateChange(
            revision=after.revision, before=before, after=after, actor=actor,
            created_at=datetime.now(timezone.utc), operation_id=operation_id,
            kind=kind, restored_from_revision=restored_from_revision,
        )
        connection.execute(
            "INSERT INTO photo_date_history VALUES (?, ?, ?, ?, ?, ?, ?)",
            (owner, photo_id, after.revision, operation_id, request, kind,
             change.model_dump_json()),
        )
