"""Source-backed personal memory, with explicit confirmation and no model calls."""
import hashlib
import json
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class Missing(LookupError):
    pass


class Conflict(ValueError):
    pass


SCHEMA = """
CREATE TABLE IF NOT EXISTS companion_sessions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, operation_id TEXT NOT NULL,
 UNIQUE(owner,operation_id)
);
CREATE TABLE IF NOT EXISTS companion_messages (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
 owner TEXT NOT NULL, session_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 text TEXT NOT NULL, created_at REAL NOT NULL,
 UNIQUE(owner,session_id,operation_id), FOREIGN KEY(session_id) REFERENCES companion_sessions(id)
);
CREATE TABLE IF NOT EXISTS companion_memories (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL,
 importance INTEGER NOT NULL, source_message_id TEXT NOT NULL, quote TEXT NOT NULL,
 actor TEXT NOT NULL, created_at REAL NOT NULL,
 FOREIGN KEY(source_message_id) REFERENCES companion_messages(id)
);
CREATE TABLE IF NOT EXISTS companion_memory_previews (
 token TEXT PRIMARY KEY, owner TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, payload TEXT NOT NULL, expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS companion_memory_receipts (
 owner TEXT NOT NULL, operation_id TEXT NOT NULL, token TEXT NOT NULL,
 action TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner,operation_id)
);
CREATE INDEX IF NOT EXISTS companion_memory_owner ON companion_memories(owner,id);
CREATE INDEX IF NOT EXISTS companion_message_owner ON companion_messages(owner,session_id,sequence);
"""
TYPES = ('preference', 'personal_fact', 'photo_recollection')


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


class CompanionStore:
    def __init__(self, path, *, initialize=False, clock=time.time):
        self.path = Path(path)
        self.clock = clock
        if not self.path.is_absolute():
            raise ValueError('Explicit absolute database path required')
        if initialize:
            with sqlite3.connect(self.path) as db:
                db.executescript(SCHEMA)

    @contextmanager
    def connection(self, *, write=False):
        db = sqlite3.connect(self.path.as_uri()+'?mode=rw', uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def one(db, table, owner, identity):
        # Table names are private constants supplied by methods, never tool data.
        row = db.execute(f'SELECT * FROM {table} WHERE owner=? AND id=?', (owner, identity)).fetchone()
        if row is None:
            raise Missing('Resource unavailable')
        return dict(row)

    def session(self, owner, operation_id):
        if not owner or not operation_id:
            raise ValueError('Identity and operation required')
        with self.connection(write=True) as db:
            row = db.execute('SELECT id FROM companion_sessions WHERE owner=? AND operation_id=?', (owner, operation_id)).fetchone()
            if row:
                return dict(session_id=row['id'])
            if db.execute('SELECT COUNT(*) FROM companion_sessions WHERE owner=?', (owner,)).fetchone()[0] >= 200:
                raise Conflict('Session capacity reached')
            identity = str(uuid.uuid4())
            db.execute('INSERT INTO companion_sessions VALUES (?,?,?)', (identity, owner, operation_id))
            return dict(session_id=identity)

    def message(self, owner, session, operation_id, text):
        if not text.strip() or len(text) > 4000:
            raise ValueError('Invalid user text')
        with self.connection(write=True) as db:
            self.one(db, 'companion_sessions', owner, session)
            old = db.execute('SELECT * FROM companion_messages WHERE owner=? AND session_id=? AND operation_id=?', (owner, session, operation_id)).fetchone()
            if old:
                if old['text'] != text:
                    raise Conflict('Message operation changed')
                return dict(old)
            if db.execute('SELECT COUNT(*) FROM companion_messages WHERE owner=? AND session_id=?', (owner, session)).fetchone()[0] >= 5000:
                raise Conflict('Message capacity reached')
            identity = str(uuid.uuid4())
            db.execute('INSERT INTO companion_messages(id,owner,session_id,operation_id,text,created_at) VALUES (?,?,?,?,?,?)', (identity, owner, session, operation_id, text, self.clock()))
            return self.one(db, 'companion_messages', owner, identity)

    def messages(self, owner, session, *, after=0, limit=20):
        if after < 0 or not 1 <= limit <= 100:
            raise ValueError('Invalid page')
        with self.connection() as db:
            self.one(db, 'companion_sessions', owner, session)
            rows = db.execute('SELECT * FROM companion_messages WHERE owner=? AND session_id=? AND sequence>? ORDER BY sequence LIMIT ?', (owner, session, after, limit+1)).fetchall()
            return dict(messages=[dict(r) for r in rows[:limit]], next_after=rows[limit-1]['sequence'] if len(rows)>limit else None)

    def memory(self, owner, identity):
        with self.connection() as db:
            return self.one(db, 'companion_memories', owner, identity)

    def memories(self, owner, *, query=None, type=None, min_importance=1, cursor='', limit=20):
        if type is not None and type not in TYPES or not 1 <= min_importance <= 5 or not 1 <= limit <= 100:
            raise ValueError('Invalid memory filter')
        if query is not None and (not query.strip() or len(query) > 100):
            raise ValueError('A search query is required')
        query = query.strip() if query is not None else None
        scope = hashlib.sha256(encode([owner, query, type, min_importance]).encode()).hexdigest()
        last = None
        if cursor:
            try:
                last = json.loads(cursor)
                if (not isinstance(last, list) or len(last) != 3 or last[0] != scope or not isinstance(last[1], int)
                        or not isinstance(last[2], str)):
                    raise ValueError('Invalid cursor')
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError('Invalid cursor') from exc
        sql = 'SELECT * FROM companion_memories WHERE owner=? AND importance>=?'
        args = [owner, min_importance]
        if type:
            sql += ' AND type=?'; args.append(type)
        if query is not None:
            literal = '%'+query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
            sql += " AND (content LIKE ? ESCAPE '\\' OR quote LIKE ? ESCAPE '\\')"; args += [literal, literal]
        if last:
            sql += ' AND (importance<? OR (importance=? AND id>?))' if query is not None else ' AND id>?'
            args += [last[1], last[1], last[2]] if query is not None else [last[2]]
        sql += ' ORDER BY importance DESC,id' if query is not None else ' ORDER BY id'
        sql += ' LIMIT ?'; args.append(limit+1)
        with self.connection() as db:
            rows = db.execute(sql, args).fetchall()
            tail = rows[limit-1] if len(rows)>limit else None
            return dict(memories=[dict(r) for r in rows[:limit]], next_cursor=encode([scope, tail['importance'], tail['id']]) if tail else None)

    def prepare(self, owner, actor, action, payload):
        if not actor:
            raise ValueError('Actor required')
        with self.connection(write=True) as db:
            db.execute('DELETE FROM companion_memory_previews WHERE expires<=?', (self.clock(),))
            if action == 'save':
                source = self.one(db, 'companion_messages', owner, payload['source_message_id'])
                if (not payload['quote'].strip() or payload['quote'] not in source['text']
                        or not payload['content'].strip() or len(payload['content'])>1600
                        or payload['type'] not in TYPES or not 1<=payload['importance']<=5):
                    raise ValueError('Invalid memory source or draft')
                values = dict(payload)
                display = dict(values, source_text=source['text'])
            elif action == 'delete':
                current = self.one(db, 'companion_memories', owner, payload['memory_id'])
                values = dict(memory_id=current['id'], digest=hashlib.sha256(encode(current).encode()).hexdigest())
                display = dict(memory=current, notice='只删除此记忆；原始聊天消息仍保留。')
            else:
                raise ValueError('Unknown memory action')
            if db.execute('SELECT COUNT(*) FROM companion_memory_previews WHERE owner=?', (owner,)).fetchone()[0] >= 100:
                raise Conflict('Pending confirmation capacity reached')
            token = secrets.token_hex(32)
            expires = self.clock()+900
            db.execute('INSERT INTO companion_memory_previews VALUES (?,?,?,?,?,?)', (token, owner, actor, action, encode(values), expires))
            return dict(status='pending_confirmation', preview_token=token, action=action, expires_at=expires, preview=display)

    def cancel(self, owner, actor, token):
        with self.connection(write=True) as db:
            db.execute('DELETE FROM companion_memory_previews WHERE owner=? AND actor=? AND token=?', (owner, actor, token))
            return dict(status='preview_closed', notice='未执行新的保存或删除；此前已确认的操作不会撤销。')

    def confirm(self, owner, actor, token, operation_id):
        if not actor or not operation_id:
            raise ValueError('Actor and operation required')
        with self.connection(write=True) as db:
            old = db.execute('SELECT * FROM companion_memory_receipts WHERE owner=? AND operation_id=?', (owner, operation_id)).fetchone()
            if old:
                # Receipt is actor-bound too, without retaining draft/quote copies.
                result = json.loads(old['result'])
                if old['token'] != token or result['actor'] != actor:
                    raise Conflict('Confirmation operation changed')
                return result
            row = db.execute('SELECT * FROM companion_memory_previews WHERE owner=? AND actor=? AND token=?', (owner, actor, token)).fetchone()
            if row is None:
                raise Missing('Preview unavailable')
            if row['expires'] <= self.clock():
                raise Conflict('Preview expired')
            values = json.loads(row['payload'])
            if row['action'] == 'save':
                self.one(db, 'companion_messages', owner, values['source_message_id'])
                if db.execute('SELECT COUNT(*) FROM companion_memories WHERE owner=?', (owner,)).fetchone()[0] >= 10000:
                    raise Conflict('Memory capacity reached')
                identity = str(uuid.uuid4())
                db.execute('INSERT INTO companion_memories VALUES (?,?,?,?,?,?,?,?,?)', (identity, owner, values['content'], values['type'], values['importance'], values['source_message_id'], values['quote'], actor, self.clock()))
            else:
                identity = values['memory_id']
                current = self.one(db, 'companion_memories', owner, identity)
                if hashlib.sha256(encode(current).encode()).hexdigest() != values['digest']:
                    raise Conflict('Memory changed')
                db.execute('DELETE FROM companion_memories WHERE owner=? AND id=?', (owner, identity))
                # Other pending delete previews contain hashes/IDs, never content.
                db.execute("DELETE FROM companion_memory_previews WHERE owner=? AND action='delete' AND json_extract(payload,'$.memory_id')=?", (owner, identity))
            result = dict(action=row['action'], memory_id=identity, actor=actor, created_at=self.clock())
            db.execute('INSERT INTO companion_memory_receipts VALUES (?,?,?,?,?)', (owner, operation_id, token, row['action'], encode(result)))
            db.execute('DELETE FROM companion_memory_previews WHERE token=?', (token,))
            db.execute('DELETE FROM companion_memory_previews WHERE expires<=?', (self.clock(),))
            return result
