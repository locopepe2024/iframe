"""Local Demo time-consent questions and synchronous organization."""

from datetime import datetime, timedelta, timezone
import uuid

from .date_store import DateStore, OperationConflict, PhotoNotAvailable
from .dates import DateAnnotation

QUESTION_VERSION = 1
PROCESSING_LOCATION = "demo_server_local"
QUESTION_TEXT = (
    "需要按拍摄时间整理这批照片吗？仅在当前 Demo 服务端本地读取日期，"
    "不调用外部模型、不分析人脸，原照片会保留。没有日期的照片将等待您确认。"
)


class PhotoWorkflowStore(DateStore):
    def batch_status(self, owner: str, batch_id: str) -> dict:
        with self._connection() as connection:
            batch = self._batch(connection, owner, batch_id)
            return {"batch_id": batch_id, "granted": bool(batch["granted"]),
                    "consent_version": batch["version"]}

    @staticmethod
    def _batch(connection, owner, batch_id):
        row = connection.execute(
            "SELECT * FROM photo_time_consents WHERE owner = ? AND batch_id = ?",
            (owner, batch_id),
        ).fetchone()
        if row is None:
            raise PhotoNotAvailable("Batch is not available")
        return row

    def time_question(self, owner: str, batch_id: str) -> dict:
        with self._connection(write=True) as connection:
            batch = self._batch(connection, owner, batch_id)
            question_id = str(uuid.uuid4())
            expires_at = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
            connection.execute(
                "INSERT INTO photo_time_questions VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(owner, batch_id) DO UPDATE SET question_id = excluded.question_id, "
                "consent_version = excluded.consent_version, expires_at = excluded.expires_at, "
                "question_version = excluded.question_version, "
                "processing_location = excluded.processing_location, "
                "question_text = excluded.question_text",
                (owner, batch_id, question_id, batch["version"], expires_at,
                 QUESTION_VERSION, PROCESSING_LOCATION, QUESTION_TEXT),
            )
            return {"question_id": question_id, "batch_id": batch_id,
                    "consent_version": batch["version"], "expires_at": expires_at,
                    "scope": "time", "question_version": QUESTION_VERSION,
                    "processing_location": PROCESSING_LOCATION, "text": QUESTION_TEXT}

    def answer_time(self, owner: str, batch_id: str, *, actor: str, question_id: str,
                    granted: bool, method: str) -> dict:
        if method not in ("button", "voice_confirmed") or not actor:
            raise ValueError("Explicit confirmation method and actor required")
        with self._connection(write=True) as connection:
            batch = self._batch(connection, owner, batch_id)
            previous = connection.execute(
                "SELECT * FROM photo_time_question_answers "
                "WHERE owner = ? AND batch_id = ? AND question_id = ?",
                (owner, batch_id, question_id),
            ).fetchone()
            if previous:
                if (bool(previous["granted"]) != granted or previous["actor"] != actor
                        or previous["method"] != method or batch["version"] != previous["consent_version"]):
                    raise OperationConflict("Question answer changed or is no longer current")
                return {"granted": granted, "consent_version": previous["consent_version"]}
            question = connection.execute(
                "SELECT * FROM photo_time_questions "
                "WHERE owner = ? AND batch_id = ? AND question_id = ?",
                (owner, batch_id, question_id),
            ).fetchone()
            if (question is None or question["consent_version"] != batch["version"]
                    or question["question_version"] != QUESTION_VERSION
                    or question["processing_location"] != PROCESSING_LOCATION
                    or question["question_text"] != QUESTION_TEXT
                    or datetime.fromisoformat(question["expires_at"]) <= datetime.now(timezone.utc)):
                raise OperationConflict("Question expired or was replaced")
            version = batch["version"] + 1
            now = datetime.now(timezone.utc).isoformat()
            self._write_consent(connection, owner, batch_id, version, granted, actor, now)
            connection.execute(
                "INSERT INTO photo_time_question_answers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (owner, batch_id, question_id, int(granted), version, actor, method,
                 PROCESSING_LOCATION, QUESTION_VERSION, now),
            )
            return {"granted": granted, "consent_version": version}

    @staticmethod
    def _write_consent(connection, owner, batch_id, version, granted, actor, now):
        connection.execute(
            "UPDATE photo_time_consents SET granted = ?, version = ? "
            "WHERE owner = ? AND batch_id = ?", (int(granted), version, owner, batch_id),
        )
        connection.execute(
            "INSERT INTO photo_time_consent_history VALUES (?, ?, ?, ?, ?, ?)",
            (owner, batch_id, version, int(granted), actor, now),
        )

    def revoke_time(self, owner: str, batch_id: str, *, actor: str,
                    expected_consent_version: int) -> dict:
        with self._connection(write=True) as connection:
            batch = self._batch(connection, owner, batch_id)
            previous = connection.execute(
                "SELECT actor, result_version FROM photo_time_revocations "
                "WHERE owner = ? AND batch_id = ? AND previous_version = ?",
                (owner, batch_id, expected_consent_version),
            ).fetchone()
            if (previous and previous["actor"] == actor
                    and previous["result_version"] == batch["version"] and not batch["granted"]):
                return {"granted": False, "consent_version": batch["version"]}
            if batch["version"] != expected_consent_version:
                raise OperationConflict("Consent version changed")
            version = batch["version"] + 1
            self._write_consent(connection, owner, batch_id, version, False, actor,
                                datetime.now(timezone.utc).isoformat())
            connection.execute(
                "INSERT INTO photo_time_revocations VALUES (?, ?, ?, ?, ?)",
                (owner, batch_id, expected_consent_version, actor, version),
            )
            return {"granted": False, "consent_version": version}

    def organize_time(self, *, owner: str, photo_id: str, actor: str,
                      operation_id: str, expected_revision: int,
                      consent_version: int) -> DateAnnotation:
        return self._change(owner, photo_id, actor, operation_id, expected_revision,
                            consent_version, "organize", {})

    def album_page(self, owner: str, *, view: str, year: int | None,
                   after_id: str, limit: int) -> dict:
        if view not in ("all", "pending") or not 1 <= limit <= 100:
            raise ValueError("Invalid album query")
        conditions = ["owner = ?", "photo_id > ?"]
        params = [owner, after_id]
        if view == "pending":
            conditions.append("album_year IS NULL")
        if year is not None:
            conditions.append("album_year = ?")
            params.append(year)
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT photo_id, batch_id, annotation FROM photo_date_states WHERE "
                + " AND ".join(conditions) + " ORDER BY photo_id LIMIT ?",
                (*params, limit + 1),
            ).fetchall()
            page = rows[:limit]
            return {"photos": [
                {"photo_id": row["photo_id"], "batch_id": row["batch_id"],
                 "date": DateAnnotation.model_validate_json(row["annotation"])} for row in page
            ], "next_after_id": page[-1]["photo_id"] if len(rows) > limit else None}
