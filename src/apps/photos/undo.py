"""Preview-bound reversal of current automatic dates, preserving user edits."""

import hashlib
import json
from datetime import datetime, timezone

from .time_tasks import PhotoTaskStore
from .date_store import DateChange, OperationConflict
from .dates import DateAnnotation


class PhotoUndoStore(PhotoTaskStore):
    def _undo_preview(self, connection, owner, batch_id):
        batch = self._batch(connection, owner, batch_id)
        photos = connection.execute(
            "SELECT photo_id,annotation FROM photo_date_states WHERE owner=? AND batch_id=? ORDER BY photo_id",
            (owner, batch_id)).fetchall()
        items = []
        for photo in photos:
            current = DateAnnotation.model_validate_json(photo["annotation"])
            target = current
            reverted = []
            for row in connection.execute(
                "SELECT change_json FROM photo_date_history WHERE owner=? AND photo_id=? ORDER BY revision DESC",
                (owner, photo["photo_id"])):
                change = DateChange.model_validate_json(row[0])
                if change.kind != "organize":
                    break
                if change.before is None:
                    raise ValueError("Automatic change has no prior snapshot")
                target = change.before
                reverted.append(change.revision)
            items.append(dict(photo_id=photo["photo_id"], revision=current.revision,
                action="undo" if reverted else "preserve", current=current.model_dump(mode="json"),
                target=target.model_dump(mode="json"), reverted_revisions=reverted))
        preview = dict(batch_id=batch_id, consent_version=batch["version"], items=items,
                       counts=dict(undo=sum(item["action"] == "undo" for item in items),
                                   preserve=sum(item["action"] == "preserve" for item in items)))
        encoded = json.dumps(dict(owner=owner, **preview), sort_keys=True).encode()
        return dict(**preview, preview_token=hashlib.sha256(encoded).hexdigest())

    def undo_preview(self, owner, batch_id):
        with self._connection() as connection:
            return self._undo_preview(connection, owner, batch_id)

    def undo_batch(self, owner, batch_id, actor, *, preview_token, operation_id):
        with self._connection(write=True) as connection:
            self._batch(connection, owner, batch_id)
            previous = connection.execute(
                "SELECT * FROM photo_batch_undos WHERE owner=? AND batch_id=? AND operation_id=?",
                (owner, batch_id, operation_id)).fetchone()
            if previous:
                if previous["preview_token"] != preview_token or previous["actor"] != actor:
                    raise OperationConflict("Undo operation changed")
                return json.loads(previous["result"])
            preview = self._undo_preview(connection, owner, batch_id)
            if preview["preview_token"] != preview_token:
                raise OperationConflict("Undo preview is stale")
            now = datetime.now(timezone.utc).isoformat()
            version = preview["consent_version"] + 1
            # Also fences pending workers. User confirmation authorizes cleanup;
            # cleanup does not require granting fresh analysis permission.
            self._write_consent(connection, owner, batch_id, version, False, actor, now)
            changes = []
            for item in preview["items"]:
                if item["action"] != "undo":
                    continue
                before = DateAnnotation.model_validate_json(json.dumps(item["current"]))
                after = DateAnnotation.model_validate_json(json.dumps({**item["target"], "revision": before.revision + 1}))
                connection.execute(
                    "UPDATE photo_date_states SET annotation=?,revision=?,album_year=? WHERE owner=? AND photo_id=?",
                    (after.model_dump_json(), after.revision, after.album_year, owner, item["photo_id"]))
                request = json.dumps(dict(batch_id=batch_id, operation_id=operation_id,
                    preview_token=preview_token, reverted_revisions=item["reverted_revisions"]), sort_keys=True)
                self._record(connection, owner, item["photo_id"], before, after, actor=actor,
                    operation_id="undo-" + operation_id, request=request, kind="undo",
                    restored_from_revision=item["target"]["revision"])
                changes.append(dict(photo_id=item["photo_id"], revision=after.revision,
                                    reverted_revisions=item["reverted_revisions"]))
            result = dict(batch_id=batch_id, operation_id=operation_id, actor=actor, created_at=now,
                          consent_version=version, counts=preview["counts"], changes=changes)
            connection.execute("INSERT INTO photo_batch_undos VALUES (?,?,?,?,?,?,?)",
                               (owner, batch_id, operation_id, preview_token, actor, now, json.dumps(result)))
            return result

    def undo_history(self, owner, batch_id, after=0, limit=20):
        with self._connection() as connection:
            self._batch(connection, owner, batch_id)
            rows = connection.execute(
                "SELECT result FROM photo_batch_undos WHERE owner=? AND batch_id=? ORDER BY created_at,operation_id LIMIT ? OFFSET ?",
                (owner, batch_id, limit + 1, after)).fetchall()
            return dict(changes=[json.loads(row[0]) for row in rows[:limit]],
                        next_after=after + limit if len(rows) > limit else None)
