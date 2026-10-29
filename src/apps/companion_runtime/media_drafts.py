"""Versioned creative briefs. This module never calls a generation provider."""
import json
import uuid

from .store import Conflict, Missing, encode
from .photo_tools import read_photos
from .ui_cards import SourceChoiceCopy, source_card, resolve_source


def display(row):
    payload = json.loads(row['payload'])
    state = row['status']
    payload.setdefault('setting', '5 秒' if payload['type'] == 'video_generate' else '方形 1:1')
    if payload['type'] == 'video_generate':
        payload.setdefault('video_mode', 't2v')
        payload.setdefault('first_photo_id', None)
        payload.setdefault('last_photo_id', None)
        payload.setdefault('reference_photo_ids', [])
    step = ('submitted' if state == 'submitted' else 'awaiting_asset' if payload['type'] == 'image_edit' and not payload['photo_id'] else
            'awaiting_brief' if not payload['brief'] else 'configuring')
    spoken = ('创作已提交，可以继续聊天。' if state == 'submitted' else '已取消这次创作。' if state == 'cancelled' else '创作要求已保留，先回到聊天。' if state == 'paused' else
              '想修改哪张照片？可以上传，或从相册选择。' if step == 'awaiting_asset' else
              '想怎么修改这张照片？' if payload['type'] == 'image_edit' and step == 'awaiting_brief' else
              '想创作什么内容？' if step == 'awaiting_brief' else
              '要求记下了，还可以继续补充。')
    result = dict(kind='media_draft', task_id=row['id'], session_id=row['session_id'],
                revision=row['revision'], status=state, step=step, **payload, spoken_text=spoken)
    card = source_card(result)
    if card:
        result.update(ui_card=card, spoken_text=card['spoken_text'])
    return result


class MediaDrafts:
    def media_draft_operation(self, owner, actor, task_id, operation_id):
        with self.connection() as db:
            row = db.execute('SELECT result FROM companion_media_draft_operations WHERE owner=? AND actor=? AND task_id=? AND operation_id=?',
                             (owner, actor, task_id, operation_id)).fetchone()
            return json.loads(row['result']) if row else None

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
            start_request = encode(dict(kind='start', session_id=session, values=values))
            receipt = db.execute('SELECT request,result FROM companion_media_draft_operations WHERE owner=? AND actor=? AND operation_id=? AND json_extract(request,\'$.kind\')=\'start\'',
                                 (owner, actor, operation_id)).fetchone()
            if receipt:
                if receipt['request'] != start_request:
                    raise Conflict('Creative operation changed')
                return json.loads(receipt['result'])
            old = db.execute('SELECT * FROM companion_media_drafts WHERE owner=? AND actor=? AND operation_id=?',
                             (owner, actor, operation_id)).fetchone()
            if old:
                if old['session_id'] != session or old['request'] != request:
                    raise Conflict('Creative operation changed')
                return display(old)
            active_row = db.execute("SELECT * FROM companion_media_drafts WHERE owner=? AND actor=? AND session_id=? AND status='active' ORDER BY rowid DESC LIMIT 1",
                                    (owner, actor, session)).fetchone()
            if active_row:
                active_payload = json.loads(active_row['payload'])
                # A new explicit creative lane is a user correction of the
                # current lane (for example: “画一张图” -> “修改一张照片”).
                # Preserve the previous draft, but make the new lane active so
                # the user can continue with its asset/brief card. Repeating
                # the same lane is idempotent for the current session.
                if active_payload.get('type') == values['type']:
                    result = display(active_row)
                    if values.get('brief', '').strip() and values['brief'].strip() != active_payload.get('brief', ''):
                        raise Conflict('请继续补充当前创作要求，或先暂停这次创作。')
                    db.execute('INSERT INTO companion_media_draft_operations VALUES (?,?,?,?,?,?)',
                               (owner, actor, active_row['id'], operation_id, start_request, encode(result)))
                    return result
                db.execute("UPDATE companion_media_drafts SET status='paused',revision=revision+1 WHERE id=? AND owner=? AND actor=?",
                           (active_row['id'], owner, actor))
            payload = dict(type=values['type'], brief=values.get('brief', '').strip(), photo_id=None)
            if values.get('source_choice') is not None:
                if values['type'] != 'image_edit':
                    raise ValueError('Source choice requires an image editing task')
                payload['source_choice'] = SourceChoiceCopy.model_validate(values['source_choice']).model_dump()
            if values['type'] == 'video_generate':
                payload.update(video_mode=values.get('video_mode') or 't2v', first_photo_id=None, last_photo_id=None, reference_photo_ids=[])
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
            if row['revision'] != values['expected_revision'] or row['status'] in ('cancelled', 'submitted'):
                raise Conflict('Creative task changed or closed')
            payload = json.loads(row['payload'])
            action = values['action']
            if action == 'choose_source':
                action = resolve_source(display(row), values.get('card_id'), values.get('option_id'))
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
            elif action in ('open_upload', 'open_album'):
                # UI navigation is part of this task, never a second draft.
                # Persist the operation receipt, but do not change the brief.
                result = display(row)
                result.update(ui_action=action, ui_event_id=operation_id, spoken_text='请在卡片中选择要上传的照片。' if action == 'open_upload' else '请在相册卡片中选择要修改的照片。')
                db.execute('INSERT INTO companion_media_draft_operations VALUES (?,?,?,?,?,?)',
                           (owner, actor, task_id, operation_id, request, encode(result)))
                return result
            elif action == 'brief':
                brief = values.get('brief', '').strip()
                if not brief:
                    raise ValueError('A concrete creative brief is required')
                payload['brief'] = brief
            elif action in ('select_photo', 'select_first_photo', 'select_last_photo', 'add_reference_photo', 'remove_reference_photo'):
                photo_id = values.get('photo_id')
                if not photo_id:
                    raise ValueError('Select a photo')
                if payload['type'] == 'video_generate' and action == 'select_first_photo':
                    target = 'first_photo_id'
                elif payload['type'] == 'video_generate' and action == 'select_last_photo':
                    target = 'last_photo_id'
                elif payload['type'] == 'video_generate' and action in ('add_reference_photo', 'remove_reference_photo'):
                    read_photos(owner, 'photo.item.read', dict(photo_id=photo_id))
                    refs = list(payload.get('reference_photo_ids', []))
                    if action == 'add_reference_photo' and photo_id not in refs:
                        if len(refs) >= 9: raise ValueError('Too many reference photos')
                        refs.append(photo_id)
                    elif action == 'remove_reference_photo':
                        refs = [item for item in refs if item != photo_id]
                    payload['reference_photo_ids'] = refs
                    target = None
                else:
                    target = 'photo_id'
                if target:
                    read_photos(owner, 'photo.item.read', dict(photo_id=photo_id))
                    payload[target] = photo_id
            elif action == 'video_mode':
                if payload['type'] != 'video_generate' or values.get('video_mode') not in ('t2v', 'i2v', 'f2v', 'r2v'):
                    raise ValueError('Unsupported video mode')
                payload['video_mode'] = values['video_mode']
            elif action == 'setting':
                setting = values.get('setting')
                allowed = ('5 秒', '10 秒') if payload['type'] == 'video_generate' else ('方形 1:1', '横向 16:9', '竖向 9:16')
                if setting not in allowed:
                    raise ValueError('Unsupported creative setting')
                payload['setting'] = setting
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
