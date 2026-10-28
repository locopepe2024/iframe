"""User-confirmed structured photo facts and recoverable deletion."""
import json
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_annotations (
 owner TEXT NOT NULL, photo_id TEXT NOT NULL, revision INTEGER NOT NULL,
 facts TEXT NOT NULL, actor TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner,photo_id)
);
CREATE TABLE IF NOT EXISTS photo_annotation_events (
 owner TEXT NOT NULL, photo_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 request TEXT NOT NULL, result TEXT NOT NULL, actor TEXT NOT NULL,
 PRIMARY KEY(owner,operation_id)
);
CREATE TABLE IF NOT EXISTS photo_deletions (
 owner TEXT NOT NULL, photo_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor TEXT NOT NULL, deleted_at TEXT NOT NULL,
 PRIMARY KEY(owner,photo_id), UNIQUE(owner,operation_id)
);
"""

class PersonFact(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    reference: str = Field(default='', max_length=120)
    name: str = Field(default='', max_length=100)
    age: int | None = Field(default=None, ge=0, le=130)
    gender: Literal['unknown', 'female', 'male', 'other'] = 'unknown'

class PhotoFacts(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    people: list[PersonFact] = Field(default_factory=list, max_length=30)
    scene: str = Field(default='', max_length=1600)
    lighting: str = Field(default='', max_length=500)
    location: str = Field(default='', max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    capture_time: str = Field(default='', max_length=25)
    notes: str = Field(default='', max_length=1600)

    @model_validator(mode='after')
    def valid_values(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError('Latitude and longitude must be supplied together')
        if self.capture_time:
            value = self.capture_time
            datetime.fromisoformat(value + ('-01-01' if len(value) == 4 else '-01' if len(value) == 7 else ''))
        return self

class AnnotationStore:
    def annotations(self, owner, photo_id):
        with self._connection() as db:
            self._photo(db, owner, photo_id)
            row = db.execute('SELECT revision,facts,actor,updated_at FROM photo_annotations WHERE owner=? AND photo_id=?', (owner,photo_id)).fetchone()
        return dict(revision=row['revision'], facts=json.loads(row['facts']), actor=row['actor'], updated_at=row['updated_at']) if row else dict(revision=0, facts=PhotoFacts().model_dump(), actor='', updated_at='')

    def save_annotations(self, owner, photo_id, actor, *, operation_id, expected_revision, facts):
        from .date_store import OperationConflict
        facts = PhotoFacts.model_validate(facts).model_dump()
        request = json.dumps(dict(photo_id=photo_id, expected_revision=expected_revision, facts=facts), sort_keys=True, ensure_ascii=False)
        with self._connection(write=True) as db:
            self._photo(db,owner,photo_id)
            old = db.execute('SELECT request,result FROM photo_annotation_events WHERE owner=? AND operation_id=?', (owner,operation_id)).fetchone()
            if old:
                if old['request'] != request: raise OperationConflict('Annotation operation changed')
                return json.loads(old['result'])
            row = db.execute('SELECT revision FROM photo_annotations WHERE owner=? AND photo_id=?', (owner,photo_id)).fetchone()
            if (row['revision'] if row else 0) != expected_revision: raise OperationConflict('Annotations changed')
            result = dict(revision=expected_revision+1,facts=facts,actor=actor,updated_at=datetime.now(timezone.utc).isoformat())
            db.execute('INSERT INTO photo_annotations VALUES (?,?,?,?,?,?) ON CONFLICT(owner,photo_id) DO UPDATE SET revision=excluded.revision,facts=excluded.facts,actor=excluded.actor,updated_at=excluded.updated_at',
                       (owner,photo_id,result['revision'],json.dumps(facts,ensure_ascii=False),actor,result['updated_at']))
            db.execute('INSERT INTO photo_annotation_events VALUES (?,?,?,?,?,?)', (owner,photo_id,operation_id,request,json.dumps(result,ensure_ascii=False),actor))
            return result

    def delete_photo(self, owner, photo_id, actor, *, operation_id):
        from .date_store import OperationConflict
        with self._connection(write=True) as db:
            old = db.execute('SELECT photo_id FROM photo_deletions WHERE owner=? AND operation_id=?', (owner,operation_id)).fetchone()
            if old:
                if old['photo_id'] != photo_id: raise OperationConflict('Deletion operation changed')
                return dict(photo_id=photo_id, status='deleted')
            self._photo(db,owner,photo_id)
            db.execute('INSERT INTO photo_deletions VALUES (?,?,?,?,?)', (owner,photo_id,operation_id,actor,datetime.now(timezone.utc).isoformat()))
        return dict(photo_id=photo_id,status='deleted')
