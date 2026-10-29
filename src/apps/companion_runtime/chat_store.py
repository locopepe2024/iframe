"""Leased turn persistence. Provider calls happen outside transactions."""
import copy
import json
import re
import secrets
import uuid
from contextlib import contextmanager

from .store import CompanionStore, Missing, Conflict, encode
from .tools import dispatch, MODELS


from .diary_store import DiaryStore
from .intent import diary_day, classify


from .photo_tasks import PhotoTasks


from .media_drafts import MediaDrafts


class ChatStore(MediaDrafts, PhotoTasks, DiaryStore, CompanionStore):
    def workflow_context(self, owner, actor, session):
        """Return a bounded, read-only snapshot for a coordinator."""
        with self.connection() as db:
            self.one(db, 'companion_sessions', owner, session)
            tasks = db.execute(
                'SELECT id,status,step,revision,payload FROM companion_photo_tasks '
                'WHERE owner=? AND actor=? AND session_id=? AND status=? ORDER BY rowid DESC LIMIT 3',
                (owner, actor, session, 'waiting_input')).fetchall()
            diaries = db.execute(
                'SELECT day,revision,updated_at FROM companion_diaries '
                'WHERE owner=? AND actor=? ORDER BY day DESC LIMIT 3', (owner, actor)).fetchall()
        active = []
        for task in tasks:
            payload = json.loads(task['payload'])
            active.append(dict(task_id=task['id'], status=task['status'], step=task['step'],
                               revision=task['revision'], candidate_count=len(payload.get('candidate_ids', [])),
                               selected=bool(payload.get('selected_id'))))
        return dict(session_id=session, focused_task=active[0]['task_id'] if active else None,
                    album_tasks=active, recent_diaries=[dict(row) for row in diaries])

    def conversation(self, owner, actor, session, *, after=0, limit=20, latest=False, before=None):
        if latest or before is not None:
            if not 1 <= limit <= 100 or (before is not None and before < 1):
                raise ValueError('Invalid page')
            with self.connection() as db:
                self.one(db, 'companion_sessions', owner, session)
                boundary = ' AND sequence<?' if before is not None else ''
                params = (owner, session, before, limit + 1) if before is not None else (owner, session, limit + 1)
                rows = db.execute('SELECT * FROM companion_messages WHERE owner=? AND session_id=?'
                                  + boundary + ' ORDER BY sequence DESC LIMIT ?', params).fetchall()
            selected = list(reversed(rows[:limit]))
            page = dict(messages=[dict(row) for row in selected], next_after=None,
                        next_before=selected[0]['sequence'] if len(rows) > limit else None)
        else:
            page = self.messages(owner, session, after=after, limit=limit)
        ids = [message['id'] for message in page['messages']]
        if not ids:
            return page
        with self.connection() as db:
            placeholders = ','.join('?' for _ in ids)
            turns = {row['message_id']: row['id'] for row in db.execute(
                f'SELECT id,message_id FROM companion_turns WHERE owner=? AND actor=? AND session_id=? AND message_id IN ({placeholders})',
                (owner, actor, session, *ids)).fetchall()}
        for message in page['messages']:
            if message['id'] in turns:
                message['turn'] = self.turn(owner, actor, turns[message['id']])
        return page

    def claim_turn(self, owner, actor, session, operation_id, text, selected_photo_id=None):
        message=self.message(owner,session,operation_id,text)
        with self.connection(write=True) as db:
            row=db.execute('SELECT * FROM companion_turns WHERE owner=? AND operation_id=?',(owner,operation_id)).fetchone()
            binding = db.execute('SELECT photo_id FROM companion_turn_photo_requests WHERE owner=? AND operation_id=?', (owner,operation_id)).fetchone()
            if row and (binding['photo_id'] if binding else None) != selected_photo_id:
                raise Conflict('Selected photo changed')
            if not row:
                db.execute('INSERT INTO companion_turn_photo_requests VALUES (?,?,?)', (owner,operation_id,selected_photo_id))
            if row:
                if row['session_id']!=session or row['text']!=text or row['actor']!=actor:
                    raise Conflict('Turn operation changed')
                if row['status']=='completed':
                    return dict(id=row['id'],cached=True)
                if row['status']=='running' and row['lease_until']>self.clock():
                    raise Conflict('Turn still running')
                identity=row['id']
            else:
                identity=str(uuid.uuid4())
                db.execute("INSERT INTO companion_turns(id,owner,actor,session_id,operation_id,text,message_id,status) VALUES (?,?,?,?,?,?,?,'queued')",
                           (identity,owner,actor,session,operation_id,text,message['id']))
            token=secrets.token_hex(32)
            db.execute("UPDATE companion_turns SET status='running',token=?,lease_until=?,result=NULL WHERE owner=? AND id=?",(token,self.clock()+120,owner,identity))
            rows=db.execute('SELECT id,text FROM companion_messages WHERE owner=? AND session_id=? AND sequence<=? ORDER BY sequence DESC LIMIT 20',(owner,session,message['sequence'])).fetchall()
            messages = [dict(r) for r in reversed(rows)]
            from .conversation_context import attach_replies, attach_last_operation
            attach_replies(db, owner, actor, session, messages)
            attach_last_operation(db, owner, actor, session, messages, identity)
            from .interaction_focus import read_focus
            focus_row = db.execute('SELECT payload FROM companion_turn_focus WHERE owner=? AND turn_id=?', (owner,identity)).fetchone()
            focus = json.loads(focus_row['payload']) if focus_row else read_focus(db, owner, actor, session)
            if not focus_row:
                db.execute('INSERT INTO companion_turn_focus VALUES (?,?,?)', (owner,identity,encode(focus)))
            messages[-1]['interaction_focus'] = focus
            creative = self.active_media_draft(db, owner, actor, session)
            if creative:
                creative['available_actions'] = ['open_upload', 'open_album', 'brief', 'pause', 'cancel']
                creative['asset_selection'] = 'user_selection_required' if not creative.get('photo_id') else 'selected'
                messages[-1]['active_media_draft'] = creative
            # Keep paused work explicit: it is resumable, never an active draft.
            from .media_drafts import display
            paused = db.execute("SELECT * FROM companion_media_drafts WHERE owner=? AND actor=? AND session_id=? AND status='paused' ORDER BY rowid DESC", (owner, actor, session)).fetchall()
            if paused:
                messages[-1]['paused_media_drafts'] = [dict(display(task), available_actions=['resume', 'cancel']) for task in paused]
            tasks = db.execute("SELECT * FROM companion_photo_tasks WHERE owner=? AND actor=? AND session_id=? AND status='waiting_input' ORDER BY rowid DESC LIMIT 3", (owner,actor,session)).fetchall()
            if tasks:
                messages[-1]['workflow_tasks'] = [dict(task_id=t['id'], revision=t['revision'], step=t['step'],
                    candidate_ids=json.loads(t['payload'])['candidate_ids'], selected_id=json.loads(t['payload'])['selected_id']) for t in tasks]
                from .photo_tools import read_photos
                for task in messages[-1]['workflow_tasks']:
                    if task['selected_id']:
                        try: task['selected_photo'] = read_photos(owner, 'photo.item.read', dict(photo_id=task['selected_id']))['photos'][0]
                        except Missing: task['selected_photo'] = None
            return dict(id=identity,token=token,message_id=message['id'],messages=messages,cached=False)

    def fail_turn(self, owner, claim):
        with self.connection(write=True) as db:
            db.execute("UPDATE companion_turns SET status='failed',token=NULL WHERE owner=? AND id=? AND token=?",(owner,claim['id'],claim['token']))

    def finish_turn(self, owner, actor, claim, proposal):
        with self.connection(write=True) as db:
            row=db.execute('SELECT * FROM companion_turns WHERE owner=? AND id=?',(owner,claim['id'])).fetchone()
            if not row or row['actor']!=actor or row['status']!='running' or row['token']!=claim['token'] or row['lease_until']<=self.clock():
                raise Conflict('Turn claim expired')
            diary_request = diary_day(row['text']) is not None
            intent = classify(row['text'])
            if any(claim.get('messages', [{}])[-1].get(key) for key in ('active_media_draft', 'paused_media_drafts')):
                # Task-specific interpretation belongs to the model. An answer
                # mentioning the album must not overwrite its tool proposal.
                from .intent import Intent
                intent = Intent('chat')
            from .interaction_focus import active_editor
            if active_editor(claim.get('messages', [{}])[-1].get('interaction_focus')):
                from .intent import Intent
                diary_request = False
                intent = Intent('chat')
            if active_editor(claim.get('messages', [{}])[-1].get('interaction_focus')) and proposal.get('name', '').startswith('media.draft.'):
                raise ValueError('Finish or leave the current editor before starting a creative task')
            arguments = proposal.get('arguments', {})
            unscoped_album = proposal.get('name') == 'photo.organize.start' and not (
                arguments.get('year') or arguments.get('query', '').strip() or arguments.get('view') == 'pending' or arguments.get('photo_id') or arguments.get('date_prefix'))
            if intent.name in ('album.scope', 'album.browse') or proposal['kind'] == 'album_guide' or unscoped_album:
                result = dict(kind='album_guide', browse=intent.name == 'album.browse',
                              spoken_text='您想整理什么时候、和谁有关的照片？也可以打开相册挑选。')
            elif proposal['kind']=='upload_guide':
                result=dict(kind='upload_guide')
            elif proposal.get('name') == 'photo.action':
                from .photo_tools import photo_store
                from ..photos.annotations import PhotoFacts
                values = MODELS['photo.action'].model_validate(proposal['arguments']).model_dump()
                tasks = db.execute("SELECT payload FROM companion_photo_tasks WHERE owner=? AND actor=? AND session_id=? AND status='waiting_input' AND step='review_photo'", (owner, actor, row['session_id'])).fetchall()
                if not any(json.loads(t['payload'])['selected_id'] == values['photo_id'] for t in tasks):
                    raise ValueError('Select this photo in the current session first')
                if values['action'] != 'edit' and values['changes']:
                    raise ValueError('Only edit actions accept changes')
                photos = photo_store()
                current = photos.annotations(owner, values['photo_id'])
                merged = PhotoFacts.model_validate({**current['facts'], **values['changes']}).model_dump()
                result = dict(kind='photo_action', photo_id=values['photo_id'], action=values['action'],
                              expected_revision=current['revision'], facts=merged,
                              spoken_text={'analyze':'要帮您分析这张照片吗？确认后会把缩略图交给看图模型。',
                                           'edit':'已整理您的修改，请核对后保存。', 'delete':'要删除这张照片吗？请先确认。'}[values['action']])
            elif proposal['kind']=='text' and not (diary_request and re.search(r'实际记忆查询结果|没有匹配的记忆|memory[._]search', proposal.get('text',''), re.I)):
                result=dict(kind='text',text=proposal['text'])
            elif diary_request:
                # A diary request is a writing task. Never expose an accidental
                # memory read as the result; ask for the missing facts instead.
                result=dict(kind='text',text='我会按这个日期整理回忆日记。现在还缺少可以整理的聊天内容，请先告诉我这一天发生了什么。')
            else:
                name=proposal['name']
                values=MODELS[name].model_validate(proposal['arguments']).model_dump()
                if name=='memory.save' and values['source_message_id']!=row['message_id']:
                    raise ValueError('Save must reference current user message')
                if name=='memory.delete' and values['memory_id'] not in row['text']:
                    raise ValueError('Select exact memory in the list first')
                # Reuse this fenced write transaction for proposal creation.
                @contextmanager
                def shared_connection(**_):
                    yield db
                scoped=copy.copy(self);scoped.connection=shared_connection
                if name == 'media.draft.start':
                    output = scoped.start_media_draft(owner,actor,row['session_id'],row['operation_id'],values)
                elif name == 'media.draft.update':
                    task_id = values.pop('task_id')
                    output = scoped.update_media_draft(owner,actor,row['session_id'],task_id,row['operation_id'],values)
                elif name == 'diary.save_draft':
                    output = scoped.save_session_draft(db, owner, actor, row['session_id'], row['id'],
                                                      values['source_turn_id'], claim['messages'][-1].get('interaction_focus'), values['day'])
                elif name == 'photo.organize.start':
                    task_id = scoped.start_photo_task(owner,actor,row['session_id'],row['operation_id'],values)
                    output = None
                elif name == 'photo.organize.input':
                    task_id = values.pop('task_id')
                    task = scoped._task(db,owner,actor,task_id)
                    if task['session_id'] != row['session_id']:
                        raise Missing('Task unavailable in this session')
                    scoped.update_photo_task(owner,actor,task_id,dict(values,operation_id=row['id']))
                    output = None
                else:
                    output=dispatch(scoped,owner,actor,name,values)
                if name.startswith('media.draft.'):
                    result = output
                elif name in ('photo.organize.start', 'photo.organize.input'):
                    result=dict(kind='photo_task',task_id=task_id)
                elif name == 'diary.save_draft':
                    result=dict(kind='text', text=output['spoken_text'], name=name, day=output['day'],
                                operation_status=output['status'])
                elif name == 'photo.album.count':
                    # Preserve the count at query time; history must not silently
                    # re-count after uploads or deletions. Text uses normal speech.
                    result=dict(kind='text', text=output['spoken_text'],
                                name=name, total=output['total'])
                elif name in ('memory.save','memory.delete'):
                    result=dict(kind='confirmation',preview_token=output['preview_token'])
                else:
                    result=dict(kind='read',name=name,arguments=values)
                    from .conversation_context import read_summary
                    summary = read_summary(name, output)
                    if summary is not None:
                        result['context_summary'] = summary
            db.execute("UPDATE companion_turns SET status='completed',token=NULL,result=? WHERE owner=? AND id=?",(encode(result),owner,claim['id']))
        return self.turn(owner,actor,claim['id'])

    def preview(self, owner, actor, token):
        with self.connection() as db:
            row=db.execute('SELECT * FROM companion_memory_previews WHERE owner=? AND actor=? AND token=? AND expires>?',(owner,actor,token,self.clock())).fetchone()
            if not row:
                return dict(status='preview_closed',preview_token=token)
            values=json.loads(row['payload'])
            if row['action']=='save':
                source=self.one(db,'companion_messages',owner,values['source_message_id'])
                display=dict(values,source_text=source['text'])
            else:
                display=dict(memory=self.one(db,'companion_memories',owner,values['memory_id']),notice='只删除此记忆；原始聊天消息仍保留。')
            return dict(status='pending_confirmation',preview_token=token,action=row['action'],expires_at=row['expires'],preview=display)

    def turn(self, owner, actor, identity):
        with self.connection() as db:
            row=self.one(db,'companion_turns',owner,identity)
            if row['actor']!=actor:
                raise Missing('Turn unavailable')
        output=dict(turn_id=identity,status=row['status'])
        if row['status']=='completed':
            result=json.loads(row['result'])
            if result['kind']=='photo_task':
                output['result']=self.photo_task(owner,actor,result['task_id'])
            elif result['kind']=='confirmation':
                output['result']=dict(kind='confirmation',**self.preview(owner,actor,result['preview_token']))
            elif result['kind']=='read':
                output['result']=dict(kind='diary_read' if result['name'].startswith('diary.') else 'photo_read' if result['name'].startswith('photo.') else 'read',name=result['name'],arguments=result['arguments'],**dispatch(self,owner,actor,result['name'],result['arguments']))
            else:
                output['result']=result
        return output
