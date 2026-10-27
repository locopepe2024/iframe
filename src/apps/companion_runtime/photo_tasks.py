"""Durable photo workflow. No provider calls or photo mutations in this slice."""
import json
import uuid

from .store import Conflict, Missing, encode
from .photo_tools import read_photos




class PhotoTasks:
    def _task(self, db, owner, actor, task_id):
        row = self.one(db, 'companion_photo_tasks', owner, task_id)
        if row['actor'] != actor:
            raise Missing('Task unavailable')
        return row

    def start_photo_task(self, owner, actor, session_id, operation_id, query):
        # Called within the chat turn's fenced transaction. Replays do not start
        # another task or change the original search scope.
        with self.connection(write=True) as db:
            self.one(db, 'companion_sessions', owner, session_id)
            old = db.execute('SELECT * FROM companion_photo_tasks WHERE owner=? AND actor=? AND operation_id=?',
                             (owner, actor, operation_id)).fetchone()
            if old:
                if old['session_id'] != session_id or json.loads(old['payload'])['query'] != query:
                    raise Conflict('Task operation changed')
                return old['id']
            page = read_photos(owner, 'photo.album.list', query)
            task_id = str(uuid.uuid4())
            payload = dict(query=query, candidate_ids=[p['photo_id'] for p in page['photos']], selected_id=None)
            db.execute('INSERT INTO companion_photo_tasks VALUES (?,?,?,?,?,?,?,?,?)',
                       (task_id, owner, actor, session_id, operation_id, 'waiting_input', 'select_photo', 1, encode(payload)))
            return task_id

    def photo_task(self, owner, actor, task_id):
        with self.connection() as db:
            row = self._task(db, owner, actor, task_id)
        payload = json.loads(row['payload'])
        photos = []
        if row['status'] == 'waiting_input':
            ids = [payload['selected_id']] if payload['selected_id'] else payload['candidate_ids']
            for photo_id in ids:
                photos.extend(read_photos(owner, 'photo.item.read', dict(photo_id=photo_id))['photos'])
        return dict(kind='photo_task', task_id=task_id, status=row['status'], step=row['step'],
                    revision=row['revision'], photos=photos)

    def update_photo_task(self, owner, actor, task_id, values):
        with self.connection(write=True) as db:
            row = self._task(db, owner, actor, task_id)
            request = encode(values)
            previous = db.execute('SELECT request FROM companion_photo_task_operations WHERE owner=? AND actor=? AND task_id=? AND operation_id=?',
                                  (owner, actor, task_id, values['operation_id'])).fetchone()
            if previous:
                if previous['request'] != request:
                    raise Conflict('Task operation changed')
            else:
                if row['revision'] != values['expected_revision'] or row['status'] != 'waiting_input':
                    raise Conflict('Task changed or closed')
                payload = json.loads(row['payload'])
                action = values['action']
                if action == 'select':
                    if row['step'] != 'select_photo' or values['photo_id'] not in payload['candidate_ids']:
                        raise ValueError('Select a photo in this task')
                    read_photos(owner, 'photo.item.read', dict(photo_id=values['photo_id']))
                    payload['selected_id'] = values['photo_id']
                    status, step = 'waiting_input', 'review_photo'
                elif action == 'close':
                    # Closing the workspace never asserts that any metadata was saved.
                    status, step = 'completed', 'closed'
                else:
                    status, step = 'cancelled', 'cancelled'
                db.execute('UPDATE companion_photo_tasks SET status=?,step=?,revision=revision+1,payload=? WHERE owner=? AND actor=? AND id=?',
                           (status, step, encode(payload), owner, actor, task_id))
                db.execute('INSERT INTO companion_photo_task_operations VALUES (?,?,?,?,?)',
                           (owner, actor, task_id, values['operation_id'], request))
        return self.photo_task(owner, actor, task_id)
