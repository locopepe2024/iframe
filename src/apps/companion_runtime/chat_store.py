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
from .intent import diary_day


class ChatStore(DiaryStore, CompanionStore):
    def conversation(self, owner, actor, session, *, after=0, limit=20):
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

    def claim_turn(self, owner, actor, session, operation_id, text):
        message=self.message(owner,session,operation_id,text)
        with self.connection(write=True) as db:
            row=db.execute('SELECT * FROM companion_turns WHERE owner=? AND operation_id=?',(owner,operation_id)).fetchone()
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
            return dict(id=identity,token=token,message_id=message['id'],messages=[dict(r) for r in reversed(rows)],cached=False)

    def fail_turn(self, owner, claim):
        with self.connection(write=True) as db:
            db.execute("UPDATE companion_turns SET status='failed',token=NULL WHERE owner=? AND id=? AND token=?",(owner,claim['id'],claim['token']))

    def finish_turn(self, owner, actor, claim, proposal):
        with self.connection(write=True) as db:
            row=db.execute('SELECT * FROM companion_turns WHERE owner=? AND id=?',(owner,claim['id'])).fetchone()
            if not row or row['actor']!=actor or row['status']!='running' or row['token']!=claim['token'] or row['lease_until']<=self.clock():
                raise Conflict('Turn claim expired')
            diary_request = diary_day(row['text']) is not None
            if proposal['kind']=='upload_guide':
                result=dict(kind='upload_guide')
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
                output=dispatch(scoped,owner,actor,name,values)
                if name in ('memory.save','memory.delete'):
                    result=dict(kind='confirmation',preview_token=output['preview_token'])
                else:
                    result=dict(kind='read',name=name,arguments=values)
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
            if result['kind']=='confirmation':
                output['result']=dict(kind='confirmation',**self.preview(owner,actor,result['preview_token']))
            elif result['kind']=='read':
                output['result']=dict(kind='read',name=result['name'],**dispatch(self,owner,actor,result['name'],result['arguments']))
            else:
                output['result']=result
        return output
