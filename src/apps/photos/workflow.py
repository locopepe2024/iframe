"""Local Demo time-consent questions and synchronous organization."""

from datetime import datetime, timedelta, timezone
import uuid
import re

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
        # Authorization changes fence pending work in the same write transaction.
        connection.execute(
            "UPDATE photo_time_task_items SET status='cancelled' WHERE owner=? AND status='pending' "
            "AND task_id IN (SELECT task_id FROM photo_time_tasks WHERE owner=? AND batch_id=? "
            "AND status IN ('queued','running') AND consent_version!=?)", (owner, owner, batch_id, version))
        connection.execute(
            "UPDATE photo_time_tasks SET status='cancelled' WHERE owner=? AND batch_id=? "
            "AND status IN ('queued','running') AND consent_version!=?", (owner, batch_id, version))
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

    def album_count(self, owner: str) -> int:
        """Count the owner's live photos without loading or paginating metadata."""
        with self._connection() as connection:
            return connection.execute(
                "SELECT COUNT(*) FROM photo_date_states p WHERE p.owner=? "
                "AND NOT EXISTS (SELECT 1 FROM photo_deletions x "
                "WHERE x.owner=p.owner AND x.photo_id=p.photo_id)", (owner,),
            ).fetchone()[0]

    def album_page(self, owner: str, *, view: str, year: int | None,
                   after_id: str, limit: int, query: str = "", date_prefix: str = "", order: str = "id") -> dict:
        if view not in ("all", "pending") or not 1 <= limit <= 100 or len(query) > 100:
            raise ValueError("Invalid album query")
        if order not in ('id', 'recent'):
            raise ValueError('Invalid album order')
        if date_prefix:
            if not re.fullmatch(r'\d{4}(?:-\d{2}(?:-\d{2})?)?', date_prefix):
                raise ValueError('Invalid album date')
            datetime.fromisoformat(date_prefix + ('-01-01' if len(date_prefix) == 4 else '-01' if len(date_prefix) == 7 else ''))
        query = query.strip()
        keywords = list(dict.fromkeys(query.split()))
        conditions = ["p.owner = ?", "NOT EXISTS (SELECT 1 FROM photo_deletions x WHERE x.owner=p.owner AND x.photo_id=p.photo_id)"]
        params = [owner]
        if order == 'recent':
            if after_id:
                conditions.append("p.rowid < (SELECT rowid FROM photo_date_states WHERE owner=? AND photo_id=?)")
                params.extend([owner, after_id])
        else:
            conditions.append("p.photo_id > ?")
            params.append(after_id)
        if date_prefix:
            conditions.append("substr(COALESCE(NULLIF(json_extract(a.facts, '$.capture_time'), ''), json_extract(p.annotation, '$.date.value')), 1, ?) = ?")
            params.extend([len(date_prefix), date_prefix])
        if view == "pending":
            conditions.append("p.album_year IS NULL AND COALESCE(json_extract(a.facts, '$.capture_time'), '') = ''")
        if year is not None:
            conditions.append("CAST(substr(COALESCE(NULLIF(json_extract(a.facts, '$.capture_time'), ''), json_extract(p.annotation, '$.date.value')), 1, 4) AS INTEGER) = ?")
            params.append(year)
        joins, fields = " LEFT JOIN photo_annotations a ON a.owner=p.owner AND a.photo_id=p.photo_id ", ""
        if query:
            # Join only the latest owner-scoped source versions, never historical
            # text or unreviewed model observations. instr treats SQL wildcards literally.
            joins += """
                LEFT JOIN photo_stories s ON s.owner=p.owner AND s.photo_id=p.photo_id
                    AND s.revision=(SELECT MAX(revision) FROM photo_stories WHERE owner=p.owner AND photo_id=p.photo_id)
                LEFT JOIN photo_description_reviews d ON d.owner=p.owner AND d.photo_id=p.photo_id
                    AND d.revision=(SELECT MAX(revision) FROM photo_description_reviews WHERE owner=p.owner AND photo_id=p.photo_id)
            """
            # Search leaf values, not JSON keys such as 'capture_time'.
            facts_text = "(SELECT group_concat(CAST(f.value AS TEXT), char(10)) FROM json_tree(a.facts) f WHERE f.type IN ('text', 'integer', 'real'))"
            fields = ", s.text AS story_text, s.revision AS story_revision, d.description AS description_text, d.revision AS description_revision, " + facts_text + " AS facts_text, a.revision AS facts_revision"
            for keyword in keywords:
                conditions.append("(instr(s.text, ?) > 0 OR instr(d.description, ?) > 0 OR EXISTS (SELECT 1 FROM json_tree(a.facts) f WHERE f.type IN ('text', 'integer', 'real') AND instr(CAST(f.value AS TEXT), ?) > 0))")
                params.extend([keyword, keyword, keyword])
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT p.photo_id, p.batch_id, p.annotation" + fields
                + " FROM photo_date_states p " + joins + " WHERE "
                + " AND ".join(conditions) + (" ORDER BY p.rowid DESC LIMIT ?" if order == "recent" else " ORDER BY p.photo_id LIMIT ?"),
                (*params, limit + 1),
            ).fetchall()
            page = rows[:limit]
            photos = []
            for row in page:
                photo = {"photo_id": row["photo_id"], "batch_id": row["batch_id"],
                         "date": DateAnnotation.model_validate_json(row["annotation"])}
                if query:
                    matches = []
                    for source in ("story", "description", "facts"):
                        text = row[source + "_text"] or ""
                        indices = [text.find(keyword) for keyword in keywords if keyword in text]
                        index = min(indices) if indices else -1
                        if index >= 0:
                            start = max(0, index - 30)
                            matches.append({"source": source, "revision": row[source + "_revision"],
                                            "excerpt": text[start:start + 160]})
                    photo["search_matches"] = matches
                photos.append(photo)
            return {"photos": photos,
                    "next_after_id": page[-1]["photo_id"] if len(rows) > limit else None}
