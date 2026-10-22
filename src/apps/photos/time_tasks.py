"""Durable short local transactions; no external work while holding a DB lock."""

import json
import uuid
from datetime import datetime, timezone

from .intake import PhotoIntakeStore
from .date_store import OperationConflict, PhotoNotAvailable, TimeConsentRequired
from .dates import DateRevisionConflict

ITEM_STATES = ("pending", "completed", "needs_confirmation", "failed", "cancelled")


class PhotoTaskStore(PhotoIntakeStore):
    @staticmethod
    def _task(connection, owner, task_id):
        row = connection.execute("SELECT * FROM photo_time_tasks WHERE owner=? AND task_id=?", (owner, task_id)).fetchone()
        if row is None:
            raise PhotoNotAvailable("Task unavailable")
        return row

    def _task_result(self, connection, owner, task_id):
        task = self._task(connection, owner, task_id)
        items = [dict(row) for row in connection.execute(
            "SELECT photo_id,expected_revision,status,error_code,result FROM photo_time_task_items "
            "WHERE owner=? AND task_id=? ORDER BY photo_id", (owner, task_id))]
        for item in items:
            item["result"] = json.loads(item["result"]) if item["result"] else None
        return {"task_id": task_id, "batch_id": task["batch_id"], "status": task["status"],
                "consent_version": task["consent_version"], "created_at": task["created_at"],
                "items": items, "counts": {state: sum(item["status"] == state for item in items) for state in ITEM_STATES}}

    def time_task(self, owner, task_id):
        with self._connection() as connection:
            return self._task_result(connection, owner, task_id)

    def time_tasks(self, owner, batch_id):
        with self._connection() as connection:
            self._batch(connection, owner, batch_id)
            ids = connection.execute("SELECT task_id FROM photo_time_tasks WHERE owner=? AND batch_id=? ORDER BY created_at DESC LIMIT 20", (owner, batch_id))
            return [self._task_result(connection, owner, row[0]) for row in ids]

    def create_time_task(self, owner, batch_id, actor, *, operation_id, consent_version, retry_task_id=None):
        request = json.dumps(dict(actor=actor, consent_version=consent_version, retry_task_id=retry_task_id), sort_keys=True)
        with self._connection(write=True) as connection:
            batch = self._batch(connection, owner, batch_id)
            if not batch["granted"] or batch["version"] != consent_version:
                raise TimeConsentRequired("Current authorization required")
            existing = connection.execute("SELECT * FROM photo_time_tasks WHERE owner=? AND batch_id=? AND operation_id=?", (owner, batch_id, operation_id)).fetchone()
            if existing:
                if existing["request"] != request:
                    raise OperationConflict("Task operation changed")
                return self._task_result(connection, owner, existing["task_id"])
            if connection.execute("SELECT 1 FROM photo_time_tasks WHERE owner=? AND batch_id=? AND status IN ('queued','running')", (owner, batch_id)).fetchone():
                raise OperationConflict("Batch already has active task")
            conditions, params = "", [owner, batch_id]
            if retry_task_id:
                old = self._task(connection, owner, retry_task_id)
                if old["batch_id"] != batch_id:
                    raise OperationConflict("Retry belongs to another batch")
                conditions = " AND photo_id IN (SELECT photo_id FROM photo_time_task_items WHERE owner=? AND task_id=? AND status='failed')"
                params.extend([owner, retry_task_id])
            photos = connection.execute("SELECT photo_id,revision FROM photo_date_states WHERE owner=? AND batch_id=?" + conditions, params).fetchall()
            if not photos:
                raise OperationConflict("No eligible uploaded photos")
            task_id = str(uuid.uuid4())
            connection.execute("INSERT INTO photo_time_tasks VALUES (?,?,?,?,?,?,?,'queued',?)",
                               (owner, task_id, batch_id, operation_id, actor, consent_version, request, datetime.now(timezone.utc).isoformat()))
            connection.executemany("INSERT INTO photo_time_task_items VALUES (?,?,?,?,'pending',NULL,NULL)",
                                   [(owner, task_id, row["photo_id"], row["revision"]) for row in photos])
            return self._task_result(connection, owner, task_id)

    def process_time_item(self):
        """One atomic unit, safe across worker processes and process termination."""
        with self._connection(write=True) as connection:
            task = connection.execute("SELECT * FROM photo_time_tasks WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1").fetchone()
            if task is None:
                return False
            owner, task_id = task["owner"], task["task_id"]
            consent = self._batch(connection, owner, task["batch_id"])
            if not consent["granted"] or consent["version"] != task["consent_version"]:
                connection.execute("UPDATE photo_time_task_items SET status='cancelled' WHERE owner=? AND task_id=? AND status='pending'", (owner, task_id))
                connection.execute("UPDATE photo_time_tasks SET status='cancelled' WHERE owner=? AND task_id=?", (owner, task_id))
                return True
            item = connection.execute("SELECT * FROM photo_time_task_items WHERE owner=? AND task_id=? AND status='pending' ORDER BY photo_id LIMIT 1", (owner, task_id)).fetchone()
            if item:
                connection.execute("SAVEPOINT organize_item")
                result, error = None, None
                try:
                    payload = json.dumps(dict(kind="organize", actor=task["actor"], expected_revision=item["expected_revision"], consent_version=task["consent_version"]), sort_keys=True)
                    result = self._change_in_connection(connection, owner, item["photo_id"], task["actor"],
                        "task-" + task_id, item["expected_revision"], task["consent_version"], "organize", {}, payload)
                    status = "needs_confirmation" if result.date is None else "completed"
                except (DateRevisionConflict, PhotoNotAvailable, ValueError) as failure:
                    connection.execute("ROLLBACK TO organize_item")
                    status = "failed"
                    error = "revision_changed" if isinstance(failure, DateRevisionConflict) else "invalid_date_state"
                connection.execute("RELEASE organize_item")
                connection.execute("UPDATE photo_time_task_items SET status=?, error_code=?,result=? WHERE owner=? AND task_id=? AND photo_id=?",
                    (status, error, result.model_dump_json() if result else None, owner, task_id, item["photo_id"]))
            counts = dict(connection.execute("SELECT status,COUNT(*) FROM photo_time_task_items WHERE owner=? AND task_id=? GROUP BY status", (owner, task_id)).fetchall())
            status = ("running" if counts.get("pending") else
                      "partial_failed" if counts.get("failed") and (counts.get("completed") or counts.get("needs_confirmation")) else
                      "failed" if counts.get("failed") else
                      "needs_confirmation" if counts.get("needs_confirmation") else "completed")
            connection.execute("UPDATE photo_time_tasks SET status=? WHERE owner=? AND task_id=?", (status, owner, task_id))
            return True
