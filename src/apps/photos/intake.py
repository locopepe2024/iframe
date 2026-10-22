"""Immutable multi-file intake; no automatic authorization or organization."""

import hashlib
import json
import uuid
from datetime import datetime, timezone

from .date_store import OperationConflict, PhotoNotAvailable
from .workflow import PhotoWorkflowStore


class PhotoIntakeStore(PhotoWorkflowStore):
    @staticmethod
    def _intake(connection, owner, batch_id):
        row = connection.execute(
            "SELECT * FROM photo_upload_batches WHERE owner=? AND batch_id=?",
            (owner, batch_id)).fetchone()
        if row is None:
            raise PhotoNotAvailable("Upload batch unavailable")
        return row

    @staticmethod
    def _intake_result(connection, owner, batch_id):
        rows = connection.execute(
            "SELECT item_id,filename,size,sha256,status,photo_id,error_code FROM photo_upload_items "
            "WHERE owner=? AND batch_id=? ORDER BY item_id", (owner, batch_id)).fetchall()
        items = [dict(row) for row in rows]
        return {"batch_id": batch_id, "items": items,
                "counts": {status: sum(item["status"] == status for item in items)
                           for status in ("pending", "uploaded", "failed")}}

    def create_intake(self, owner, batch_id, items):
        manifest = json.dumps(sorted(items, key=lambda item: item["item_id"]), sort_keys=True)
        with self._connection(write=True) as connection:
            existing = connection.execute(
                "SELECT manifest FROM photo_upload_batches WHERE owner=? AND batch_id=?",
                (owner, batch_id)).fetchone()
            if existing and existing["manifest"] != manifest:
                raise OperationConflict("Batch manifest changed")
            if not existing:
                connection.execute("INSERT INTO photo_upload_batches VALUES (?,?,?,?)",
                                   (owner, batch_id, manifest, datetime.now(timezone.utc).isoformat()))
                connection.execute("INSERT INTO photo_time_consents VALUES (?,?,0,0)", (owner, batch_id))
                connection.executemany(
                    "INSERT INTO photo_upload_items VALUES (?,?,?,?,?,?,'pending',NULL,NULL)",
                    [(owner, batch_id, item["item_id"], item["filename"], item["size"], item["sha256"])
                     for item in items])
            return self._intake_result(connection, owner, batch_id)

    def intake(self, owner, batch_id):
        with self._connection() as connection:
            self._intake(connection, owner, batch_id)
            return self._intake_result(connection, owner, batch_id)

    def intake_page(self, owner, after, limit):
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT batch_id FROM photo_upload_batches WHERE owner=? AND batch_id>? ORDER BY batch_id LIMIT ?",
                (owner, after, limit + 1)).fetchall()
            return {"batches": [self._intake_result(connection, owner, row["batch_id"]) for row in rows[:limit]],
                    "next_after_id": rows[limit - 1]["batch_id"] if len(rows) > limit else None}

    def intake_item(self, owner, batch_id, item_id):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM photo_upload_items WHERE owner=? AND batch_id=? AND item_id=?",
                (owner, batch_id, item_id)).fetchone()
            if row is None:
                raise PhotoNotAvailable("Upload item unavailable")
            return dict(row)

    def fail_intake_item(self, owner, batch_id, item_id, code):
        if code not in ("invalid_image", "image_limit", "file_mismatch"):
            raise ValueError("Invalid intake error")
        with self._connection(write=True) as connection:
            self._intake(connection, owner, batch_id)
            # A late failure must never undo another request's successful commit.
            connection.execute(
                "UPDATE photo_upload_items SET status='failed', error_code=? "
                "WHERE owner=? AND batch_id=? AND item_id=? AND status!='uploaded'",
                (code, owner, batch_id, item_id))

    def upload_intake_item(self, owner, batch_id, item_id, prepared):
        digest = hashlib.sha256(prepared.original).hexdigest()
        with self._connection(write=True) as connection:
            row = connection.execute(
                "SELECT * FROM photo_upload_items WHERE owner=? AND batch_id=? AND item_id=?",
                (owner, batch_id, item_id)).fetchone()
            if row is None:
                raise PhotoNotAvailable("Upload item unavailable")
            if row["sha256"] != digest or row["size"] != len(prepared.original):
                raise OperationConflict("File does not match manifest")
            if row["status"] == "uploaded":
                return {"photo_id": row["photo_id"], "batch_id": batch_id, "created": False}
            photo_id = str(uuid.uuid4())
            self._register(connection, owner, batch_id, photo_id, prepared.evidence)
            connection.execute("INSERT INTO photo_media VALUES (?,?,?,?,?,?,?)",
                               (owner, photo_id, "intake-" + photo_id, digest, prepared.media_type,
                                prepared.original, prepared.thumbnail))
            connection.execute(
                "UPDATE photo_upload_items SET status='uploaded', photo_id=?, error_code=NULL "
                "WHERE owner=? AND batch_id=? AND item_id=?", (photo_id, owner, batch_id, item_id))
            return {"photo_id": photo_id, "batch_id": batch_id, "created": True}
