"""Preview-bound manual curation; never invokes face analysis or edits media."""

import hashlib
import json
import uuid

from .date_store import OperationConflict, PhotoNotAvailable
from .people_review import PhotoPeopleReviewStore


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


class PhotoPeopleCorrectionStore(PhotoPeopleReviewStore):
    def _correction_plan(self, connection, owner, *, action, person_id='', target_id='',
                         members=(), batch_id='', label=''):
        if action not in ('remove', 'split', 'merge', 'undo_batch') or len(label) > 80:
            raise ValueError('Invalid correction')
        keys = [(m['task_id'], m['face_id']) for m in members]
        if len(keys) != len(set(keys)) or len(keys) > 400:
            raise ValueError('Invalid face selection')
        if action == 'undo_batch':
            if person_id or target_id or keys or label:
                raise ValueError('Unexpected batch selection')
            self._batch(connection, owner, batch_id)
            rows = connection.execute('''SELECT m.*, CASE WHEN p.face_id IS NULL THEN 0 ELSE 1 END AS protected
                FROM photo_people_members m JOIN photo_people_tasks t ON t.owner=m.owner AND t.task_id=m.task_id
                LEFT JOIN photo_people_manual_members p ON p.owner=m.owner AND p.task_id=m.task_id AND p.face_id=m.face_id
                WHERE m.owner=? AND t.batch_id=? ORDER BY m.task_id,m.face_id''', (owner, batch_id)).fetchall()
            affected = [dict(row) for row in rows if not row['protected']]
            preserved = sum(row['protected'] for row in rows)
            ids = sorted({row['person_id'] for row in rows})
        else:
            if batch_id or (action != 'split' and label) or (action != 'merge' and target_id):
                raise ValueError('Unexpected selection')
            ids = sorted({person_id, target_id} if action == 'merge' else {person_id})
            for person in ids:
                if not connection.execute('SELECT 1 FROM photo_people_persons WHERE owner=? AND person_id=?', (owner, person)).fetchone():
                    raise PhotoNotAvailable('Person unavailable')
            rows = connection.execute('SELECT * FROM photo_people_members WHERE owner=? AND person_id=? ORDER BY task_id,face_id', (owner, person_id)).fetchall()
            if action == 'merge':
                if keys or person_id == target_id or not rows:
                    raise ValueError('Invalid merge')
                if not connection.execute('SELECT 1 FROM photo_people_members WHERE owner=? AND person_id=?', (owner, target_id)).fetchone():
                    raise OperationConflict('Target person is empty')
                affected = [dict(row) for row in rows]
            else:
                if not keys:
                    raise ValueError('Select faces')
                affected = [dict(row) for row in rows if (row['task_id'], row['face_id']) in set(keys)]
                if len(affected) != len(keys):
                    raise OperationConflict('Face selection changed')
                if action == 'split' and len(affected) == len(rows):
                    raise ValueError('Split must leave faces in original person')
            preserved = 0
        snapshots = []
        for person in ids:
            row = connection.execute('SELECT person_id,label FROM photo_people_persons WHERE owner=? AND person_id=?', (owner, person)).fetchone()
            current = [dict(m) for m in connection.execute('SELECT task_id,face_id,photo_id,box FROM photo_people_members WHERE owner=? AND person_id=? ORDER BY task_id,face_id', (owner, person))]
            snapshots.append({**dict(row), 'members': current})
        sequence = connection.execute('SELECT COALESCE(MAX(sequence),0) FROM photo_people_correction_events WHERE owner=?', (owner,)).fetchone()[0]
        selection = dict(action=action, person_id=person_id, target_id=target_id,
                         members=sorted([dict(task_id=t, face_id=f) for t, f in keys], key=lambda m: (m['task_id'], m['face_id'])),
                         batch_id=batch_id, label=label.strip())
        token = hashlib.sha256(canonical(dict(owner=owner, sequence=sequence, selection=selection, snapshots=snapshots, affected=affected)).encode()).hexdigest()
        return dict(preview_token=token, selection=selection, people=snapshots,
                    affected=[{k: row[k] for k in ('person_id','task_id','face_id','photo_id','box')} for row in affected],
                    counts=dict(members=len(affected), photos=len({row['photo_id'] for row in affected}), preserve=preserved))

    def people_correction_preview(self, owner, **selection):
        with self._connection() as connection:
            return self._correction_plan(connection, owner, **selection)

    def correct_people(self, owner, actor, *, operation_id, preview_token, **selection):
        if not actor or not operation_id:
            raise ValueError('Explicit operation required')
        request = canonical(dict(actor=actor, preview_token=preview_token, selection=selection))
        with self._connection(write=True) as connection:
            previous = connection.execute('SELECT request,result FROM photo_people_correction_events WHERE owner=? AND operation_id=?', (owner, operation_id)).fetchone()
            if previous:
                if previous['request'] != request:
                    raise OperationConflict('Correction operation changed')
                return json.loads(previous['result'])
            plan = self._correction_plan(connection, owner, **selection)
            if plan['preview_token'] != preview_token:
                raise OperationConflict('Correction preview changed')
            if not plan['affected']:
                raise ValueError('No relationships to change')
            action = selection['action']
            destination = None
            if action == 'split':
                destination = str(uuid.uuid4())
                connection.execute('INSERT INTO photo_people_persons VALUES (?,?,?,?,?)', (owner, destination, selection.get('label','').strip(), actor, self.clock()))
            elif action == 'merge':
                destination = selection['target_id']
            for member in plan['affected']:
                key = (owner, member['task_id'], member['face_id'])
                if destination:
                    connection.execute('UPDATE photo_people_members SET person_id=? WHERE owner=? AND task_id=? AND face_id=?', (destination, *key))
                else:
                    connection.execute('DELETE FROM photo_people_members WHERE owner=? AND task_id=? AND face_id=?', key)
                if action != 'undo_batch':
                    connection.execute('INSERT OR REPLACE INTO photo_people_manual_members VALUES (?,?,?,?)', (*key, operation_id))
                # A confirmed candidate is historical evidence, never current truth.
                groups = connection.execute("SELECT group_id,members FROM photo_people_groups WHERE owner=? AND task_id=? AND status='confirmed'", key[:2]).fetchall()
                for group in groups:
                    if any(m['face_id'] == member['face_id'] for m in json.loads(group['members'])):
                        connection.execute("UPDATE photo_people_groups SET status='corrected',revision=revision+1 WHERE owner=? AND group_id=?", (owner, group['group_id']))
            if action == 'merge':
                # Choosing the combined identity also protects the target's
                # previous members from a later broad source-batch undo.
                for person in plan['people']:
                    for member in person['members']:
                        connection.execute('INSERT OR REPLACE INTO photo_people_manual_members VALUES (?,?,?,?)',
                                           (owner, member['task_id'], member['face_id'], operation_id))
            after_ids = {p['person_id'] for p in plan['people']}
            if destination:
                after_ids.add(destination)
            after = [{**dict(connection.execute('SELECT person_id,label FROM photo_people_persons WHERE owner=? AND person_id=?', (owner, person)).fetchone()),
                      'members': [dict(row) for row in connection.execute('SELECT task_id,face_id,photo_id,box FROM photo_people_members WHERE owner=? AND person_id=? ORDER BY task_id,face_id', (owner, person))]}
                     for person in sorted(after_ids)]
            result = dict(operation_id=operation_id, action=action, person_id=destination,
                          counts=plan['counts'], before=plan['people'], after=after, created_at=self.clock())
            connection.execute('INSERT INTO photo_people_correction_events(owner,operation_id,request,actor,result,created_at) VALUES (?,?,?,?,?,?)',
                               (owner, operation_id, request, actor, canonical(result), result['created_at']))
            return result

    def people_correction_history(self, owner, *, after=0, limit=20):
        if after < 0 or not 1 <= limit <= 100:
            raise ValueError('Invalid history page')
        with self._connection() as connection:
            rows = connection.execute('SELECT sequence,actor,result FROM photo_people_correction_events WHERE owner=? AND sequence>? ORDER BY sequence LIMIT ?', (owner, after, limit+1)).fetchall()
            return dict(changes=[dict(sequence=row['sequence'], actor=row['actor'], **json.loads(row['result'])) for row in rows[:limit]],
                        next_after=rows[limit-1]['sequence'] if len(rows)>limit else None)
