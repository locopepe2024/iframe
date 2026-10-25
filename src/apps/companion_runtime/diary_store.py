"""Explicitly saved personal diaries, isolated from model tools and memory writes."""
import json
from datetime import date

from .store import Conflict, Missing, encode




class DiaryStore:
    def diaries(self, owner, actor, month):
        date.fromisoformat(month + '-01')
        with self.connection() as db:
            return dict(diaries=[dict(row) for row in db.execute(
                'SELECT day,text,source_turn_id,revision,updated_at FROM companion_diaries WHERE owner=? AND actor=? AND substr(day,1,7)=? ORDER BY day',
                (owner, actor, month)).fetchall()])

    def save_diary(self, owner, actor, day, *, operation_id, text, source_turn_id, expected_revision):
        if date.fromisoformat(day).isoformat() != day or not text.strip():
            raise ValueError('Invalid diary')
        payload = encode(dict(day=day,text=text,source_turn_id=source_turn_id,expected_revision=expected_revision))
        with self.connection(write=True) as db:
            receipt = db.execute('SELECT * FROM companion_diary_receipts WHERE owner=? AND actor=? AND operation_id=?', (owner,actor,operation_id)).fetchone()
            if receipt:
                if receipt['payload'] != payload:
                    raise Conflict('Diary operation changed')
                return json.loads(receipt['result'])
            # Empty source explicitly denotes a diary written directly by the user.
            if source_turn_id:
                source = db.execute('SELECT status,result FROM companion_turns WHERE owner=? AND actor=? AND id=?', (owner,actor,source_turn_id)).fetchone()
                if not source:
                    raise Missing('Diary source unavailable')
                if source['status'] != 'completed' or json.loads(source['result'] or '{}').get('kind') != 'text':
                    raise ValueError('Diary requires a completed text reply')
            existing = db.execute('SELECT revision FROM companion_diaries WHERE owner=? AND actor=? AND day=?', (owner,actor,day)).fetchone()
            if (existing['revision'] if existing else 0) != expected_revision:
                raise Conflict('Diary has changed')
            result = dict(day=day,text=text,source_turn_id=source_turn_id,revision=expected_revision+1,updated_at=self.clock())
            db.execute('INSERT INTO companion_diaries VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner,actor,day) DO UPDATE SET text=excluded.text,source_turn_id=excluded.source_turn_id,revision=excluded.revision,updated_at=excluded.updated_at',
                       (owner,actor,day,text,source_turn_id,result['revision'],result['updated_at']))
            db.execute('INSERT INTO companion_diary_receipts VALUES (?,?,?,?,?)', (owner,actor,operation_id,payload,encode(result)))
            return result
