"""Versioned creative briefs. This module never calls a generation provider."""
import json
import uuid

from .store import Conflict, Missing, encode
from .photo_tools import read_photos


def display(row):
    payload = json.loads(row['payload'])
    state = row['status']
    step = ('awaiting_asset' if payload['type'] == 'image_edit' and not payload['photo_id'] else
            'awaiting_brief' if not payload['brief'] else 'configuring')
    spoken = ('已取消这次创作。' if state == 'cancelled' else '创作要求已保留，先回到聊天。' if state == 'paused' else
              '想修改哪张照片？可以上传，或从相册选择。' if step == 'awaiting_asset' else
              '想怎么修改这张照片？' if payload['type'] == 'image_edit' and step == 'awaiting_brief' else
              '想创作什么内容？' if step == 'awaiting_brief' else
              '要求记下了，可以继续补充，也可以查看生成设置。')
    return dict(kind='media_draft', task_id=row['id'], session_id=row['session_id'],
                revision=row['revision'], status=state, step=step, **payload, spoken_text=spoken)


class MediaDrafts:
    def media_draft(self, owner, actor, task_id):
        with self.connection() as db:
            row = self.one(db, 'companion_media_drafts', owner, task_id)
            if row['actor'] != actor:
                raise Missing('Creative task unavailable')
            return display(row)

    def active_media_draft(self, db, owner, actor, session):
        row = db.execute("SELECT * FROM companion_media_drafts WHERE owner=? AND actor=? AND session_id=? AND status='active' ORDER BY rowid DESC LIMIT 1",
                         (owner, actor, session)).fetchone()
        return display(row) if row else None

    def start_media_draft(self, owner, actor, session, operation_id, values):
        with self.connection(write=True) as db:
            self.one(db, 'companion_sessions', owner, session)
            request = encode(values)
            old = db.execute('SELECT * FROM companion_media_drafts WHERE owner=? AND actor=? AND operation_id=?',
                             (owner, actor, operation_id)).fetchone()
            if old:
                if old['session_id'] != session or old['request'] != request:
                    raise Conflict('Creative operation changed')
                return display(old)
            if self.active_media_draft(db, owner, actor, session):
                raise Conflict('Pause or cancel the current creative task before starting another')
            payload = dict(type=values['type'], brief=values.get('brief', '').strip(), photo_id=None)
            task_id = str(uuid.uuid4())
            db.execute('INSERT INTO companion_media_drafts VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (task_id, owner, actor, session, operation_id, request, 'active', 1, encode(payload), self.clock()))
            return display(self.one(db, 'companion_media_drafts', owner, task_id))

    def update_media_draft(self, owner, actor, session, task_id, operation_id, values):
        with self.connection(write=True) as db:
            row = self.one(db, 'companion_media_drafts', owner, task_id)
            if row['actor'] != actor or row['session_id'] != session:
                raise Missing('Creative task unavailable in this session')
            request = encode(values)
            previous = db.execute('SELECT request,result FROM companion_media_draft_operations WHERE owner=? AND actor=? AND task_id=? AND operation_id=?',
                                  (owner, actor, task_id, operation_id)).fetchone()
            if previous:
                if previous['request'] != request:
                    raise Conflict('Creative operation changed')
                return json.loads(previous['result'])
            if row['revision'] != values['expected_revision'] or row['status'] == 'cancelled':
                raise Conflict('Creative task changed or closed')
            payload = json.loads(row['payload'])
            action = values['action']
            status = row['status']
            if action == 'resume':
                other = self.active_media_draft(db, owner, actor, session)
                if other and other['task_id'] != task_id:
                    raise Conflict('Another creative task is active')
                status = 'active'
            elif action in ('pause', 'cancel'):
                status = 'paused' if action == 'pause' else 'cancelled'
            elif status != 'active':
                raise Conflict('Resume the task before changing its brief')
            elif action == 'brief':
                brief = values.get('brief', '').strip()
                if not brief:
                    raise ValueError('A concrete creative brief is required')
                payload['brief'] = brief
            elif action == 'select_photo':
                photo_id = values.get('photo_id')
                if not photo_id:
                    raise ValueError('Select a photo')
                # Same owner-scoped live photo read used by the album tools.
                read_photos(owner, 'photo.item.read', dict(photo_id=photo_id))
                payload['photo_id'] = photo_id
            elif action == 'clear_photo':
                payload['photo_id'] = None
            else:
                raise ValueError('Unknown creative draft action')
            db.execute('UPDATE companion_media_drafts SET status=?,revision=revision+1,payload=? WHERE id=? AND owner=? AND actor=?',
                       (status, encode(payload), task_id, owner, actor))
            result = display(self.one(db, 'companion_media_drafts', owner, task_id))
            db.execute('INSERT INTO companion_media_draft_operations VALUES (?,?,?,?,?,?)',
                       (owner, actor, task_id, operation_id, request, encode(result)))
            return result
