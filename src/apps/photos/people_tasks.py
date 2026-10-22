"""Person-analysis persistence. Worker methods are internal, never model tools."""

from dataclasses import asdict, dataclass, field
import hashlib
import json
import time
import uuid

from .undo import PhotoUndoStore
from .date_store import OperationConflict, PhotoNotAvailable
from .faces import MODEL_FILES, MODEL_VERSION, FaceObservation, MAX_FACES

FINGERPRINT = hashlib.sha256(json.dumps(dict(model=MODEL_VERSION, files=MODEL_FILES), sort_keys=True).encode()).hexdigest()
DISCLOSURE = (
    '仅在当前 Demo 服务端本地比较这批照片中的人脸，不发送给外部人物分析服务。'
    '保存人脸特征并产生待确认建议，不自动认定身份、称呼或亲属关系。'
    '原照片保留，可停止分析并选择清除本批人脸特征。'
)
LEASE_SECONDS = 120
MAX_ATTEMPTS = 3
STATES = ('pending', 'running', 'detected', 'no_faces', 'failed', 'cancelled', 'cleared')


class PeopleConsentRequired(PermissionError):
    pass


@dataclass(frozen=True)
class PeopleClaim:
    owner: str
    task_id: str
    photo_id: str
    token: str = field(repr=False)
    fingerprint: str
    thumbnail: bytes = field(repr=False)


class PhotoPeopleStore(PhotoUndoStore):
    def __init__(self, path, *, initialize=True, clock=None):
        super().__init__(path, initialize=initialize)
        self.clock = clock or time.time

    def _consent(self, connection, owner, batch):
        self._batch(connection, owner, batch)
        row = connection.execute('SELECT * FROM photo_people_consents WHERE owner=? AND batch_id=?', (owner,batch)).fetchone()
        return dict(row) if row else dict(version=0, granted=0)

    def people_consent(self, owner, batch):
        with self._connection() as connection:
            value = self._consent(connection,owner,batch)
            return dict(granted=bool(value['granted']), consent_version=value['version'])

    def people_question(self, owner, batch):
        with self._connection(write=True) as connection:
            consent = self._consent(connection,owner,batch)
            question, expires = str(uuid.uuid4()), self.clock()+900
            disclosure = DISCLOSURE + ' 模型：' + MODEL_VERSION + '，指纹：' + FINGERPRINT
            connection.execute('INSERT INTO photo_people_questions VALUES (?,?,?,?,?,?) ON CONFLICT(owner,batch_id) DO UPDATE SET question_id=excluded.question_id,version=excluded.version,expires=excluded.expires,disclosure=excluded.disclosure',
                (owner,batch,question,consent['version'],expires,disclosure))
            return dict(question_id=question,consent_version=consent['version'],expires_at=expires,text=DISCLOSURE,scope='people',processing_location='demo_server_local',fingerprint=FINGERPRINT)

    def change_people_consent(self, owner, batch, actor, *, operation_id, expected_version,
                              granted, question_id=None, clear=False):
        if (not actor or not operation_id or type(granted) is not bool or type(clear) is not bool
                or type(expected_version) is not int or expected_version < 0 or (granted and clear)):
            raise ValueError('Invalid explicit consent operation')
        request = json.dumps(dict(actor=actor,expected_version=expected_version,granted=granted,question_id=question_id,clear=clear),sort_keys=True)
        with self._connection(write=True) as connection:
            consent = self._consent(connection,owner,batch)
            old = connection.execute('SELECT * FROM photo_people_consent_events WHERE owner=? AND batch_id=? AND operation_id=?',(owner,batch,operation_id)).fetchone()
            if old:
                if old['request'] != request:
                    raise OperationConflict('Consent operation changed')
                return dict(granted=bool(old['granted']),consent_version=old['version'],cleared=bool(old['cleared']))
            if consent['version'] != expected_version:
                raise OperationConflict('People consent changed')
            if granted:
                question = connection.execute('SELECT * FROM photo_people_questions WHERE owner=? AND batch_id=?',(owner,batch)).fetchone()
                if (not question or question['question_id'] != question_id or question['version'] != expected_version
                        or question['expires'] <= self.clock()
                        or question['disclosure'] != DISCLOSURE + ' 模型：' + MODEL_VERSION + '，指纹：' + FINGERPRINT):
                    raise OperationConflict('People question expired or changed')
            version = consent['version']+1
            connection.execute('INSERT INTO photo_people_consents VALUES (?,?,?,?) ON CONFLICT(owner,batch_id) DO UPDATE SET version=excluded.version,granted=excluded.granted',(owner,batch,version,int(granted)))
            connection.execute("UPDATE photo_people_items SET status='cancelled',token=NULL,lease_until=NULL WHERE owner=? AND status IN ('pending','running') AND task_id IN (SELECT task_id FROM photo_people_tasks WHERE owner=? AND batch_id=?)",(owner,owner,batch))
            connection.execute("UPDATE photo_people_tasks SET status='cancelled' WHERE owner=? AND batch_id=? AND status IN ('queued','running')",(owner,batch))
            if clear:
                self._clear_people_candidates(connection, owner, batch)
                connection.execute("UPDATE photo_people_tasks SET status='cleared' WHERE owner=? AND batch_id=? AND status NOT IN ('cancelled','failed')",(owner,batch))
                connection.execute('DELETE FROM photo_people_faces WHERE owner=? AND task_id IN (SELECT task_id FROM photo_people_tasks WHERE owner=? AND batch_id=?)',(owner,owner,batch))
                connection.execute("UPDATE photo_people_items SET status='cleared',face_count=0 WHERE owner=? AND status='detected' AND task_id IN (SELECT task_id FROM photo_people_tasks WHERE owner=? AND batch_id=?)",(owner,owner,batch))
            connection.execute('INSERT INTO photo_people_consent_events VALUES (?,?,?,?,?,?,?,?,?)',(owner,batch,operation_id,request,version,int(granted),actor,self.clock(),int(clear)))
            return dict(granted=granted,consent_version=version,cleared=clear)

    def _clear_people_candidates(self, connection, owner, batch):
        # Only automatic, unconfirmed suggestions are removed with features.
        connection.execute("DELETE FROM photo_people_groups WHERE owner=? AND status NOT IN ('confirmed','corrected') AND task_id IN (SELECT task_id FROM photo_people_tasks WHERE owner=? AND batch_id=?)", (owner,owner,batch))

    def _people_task(self, connection, owner, task):
        row = connection.execute('SELECT * FROM photo_people_tasks WHERE owner=? AND task_id=?',(owner,task)).fetchone()
        if not row:
            raise PhotoNotAvailable('People task unavailable')
        return row

    def _result(self, connection, owner, task):
        row = self._people_task(connection,owner,task)
        items = [dict(item) for item in connection.execute('SELECT photo_id,status,attempts,face_count,error_code FROM photo_people_items WHERE owner=? AND task_id=? ORDER BY photo_id',(owner,task))]
        return dict(task_id=task,batch_id=row['batch_id'],status=row['status'],created_at=row['created_at'],consent_version=row['consent_version'],fingerprint=row['fingerprint'],items=items,
                    counts={state:sum(item['status']==state for item in items) for state in STATES})

    def people_task(self, owner, task):
        with self._connection() as connection:
            return self._result(connection,owner,task)

    def create_people_task(self, owner, batch, actor, *, operation_id, consent_version, retry_task_id=None):
        if not actor or not operation_id:
            raise ValueError('Actor and operation required')
        request = json.dumps(dict(actor=actor,consent_version=consent_version,retry_task_id=retry_task_id,fingerprint=FINGERPRINT),sort_keys=True)
        with self._connection(write=True) as connection:
            consent = self._consent(connection,owner,batch)
            if not consent['granted'] or consent['version'] != consent_version:
                raise PeopleConsentRequired('Independent people consent required')
            old = connection.execute('SELECT * FROM photo_people_tasks WHERE owner=? AND batch_id=? AND operation_id=?',(owner,batch,operation_id)).fetchone()
            if old:
                if old['request'] != request:
                    raise OperationConflict('Task operation changed')
                return self._result(connection,owner,old['task_id'])
            if connection.execute("SELECT 1 FROM photo_people_tasks WHERE owner=? AND batch_id=? AND status IN ('queued','running')",(owner,batch)).fetchone():
                raise OperationConflict('People task already active')
            conditions, params = '', [owner,batch]
            if retry_task_id:
                retry = self._people_task(connection,owner,retry_task_id)
                if retry['batch_id'] != batch or retry['status'] in ('queued','running'):
                    raise OperationConflict('Retry task not eligible')
                conditions = " AND m.photo_id IN (SELECT photo_id FROM photo_people_items WHERE owner=? AND task_id=? AND status='failed')"
                params += [owner,retry_task_id]
            photos = connection.execute('SELECT m.photo_id,m.thumbnail FROM photo_media m JOIN photo_date_states p ON p.owner=m.owner AND p.photo_id=m.photo_id WHERE p.owner=? AND p.batch_id=?'+conditions,params).fetchall()
            if not 1 <= len(photos) <= 20:
                raise OperationConflict('Need 1–20 eligible uploaded photos')
            task = str(uuid.uuid4())
            connection.execute('INSERT INTO photo_people_tasks VALUES (?,?,?,?,?,?,?,?,?,?)',(owner,task,batch,operation_id,actor,consent_version,FINGERPRINT,request,'queued',self.clock()))
            connection.executemany("INSERT INTO photo_people_items VALUES (?,?,?,?,'pending',NULL,NULL,0,0,NULL)",[(owner,task,p['photo_id'],hashlib.sha256(p['thumbnail']).hexdigest()) for p in photos])
            return self._result(connection,owner,task)

    def _summarize(self, connection, owner, task):
        row = self._people_task(connection,owner,task)
        if row['status']=='cancelled':
            return
        counts = dict(connection.execute('SELECT status,COUNT(*) FROM photo_people_items WHERE owner=? AND task_id=? GROUP BY status',(owner,task)).fetchall())
        status = ('running' if counts.get('running') or counts.get('pending') else
                  'partial_failed' if counts.get('failed') and (counts.get('detected') or counts.get('no_faces')) else
                  'failed' if counts.get('failed') else 'needs_review' if counts.get('detected') else 'completed')
        connection.execute('UPDATE photo_people_tasks SET status=? WHERE owner=? AND task_id=?',(status,owner,task))

    def _validate_claim(self, connection, claim):
        task = self._people_task(connection,claim.owner,claim.task_id)
        consent = self._consent(connection,claim.owner,task['batch_id'])
        item = connection.execute('SELECT * FROM photo_people_items WHERE owner=? AND task_id=? AND photo_id=?',(claim.owner,claim.task_id,claim.photo_id)).fetchone()
        if not consent['granted'] or consent['version'] != task['consent_version']:
            raise PeopleConsentRequired('People authorization no longer current')
        if (not item or task['status'] != 'running' or item['status'] != 'running'
                or item['token'] != claim.token or item['lease_until'] <= self.clock()
                or task['fingerprint'] != FINGERPRINT or claim.fingerprint != FINGERPRINT):
            raise OperationConflict('Worker lease no longer current')
        photo = connection.execute('SELECT m.thumbnail,p.batch_id FROM photo_media m JOIN photo_date_states p ON p.owner=m.owner AND p.photo_id=m.photo_id WHERE m.owner=? AND m.photo_id=?',(claim.owner,claim.photo_id)).fetchone()
        if (not photo or photo['batch_id'] != task['batch_id']
                or hashlib.sha256(photo['thumbnail']).hexdigest() != item['image_hash']
                or hashlib.sha256(claim.thumbnail).hexdigest() != item['image_hash']):
            raise OperationConflict('People source image changed')
        return item

    def claim_people_item(self):
        with self._connection(write=True) as connection:
            rows = connection.execute("SELECT i.*,t.batch_id,t.consent_version,t.fingerprint FROM photo_people_items i JOIN photo_people_tasks t ON t.owner=i.owner AND t.task_id=i.task_id WHERE t.status IN ('queued','running') AND (i.status='pending' OR (i.status='running' AND i.lease_until<=?)) ORDER BY t.created_at,t.task_id,i.photo_id LIMIT 100",(self.clock(),)).fetchall()
            for item in rows:
                owner, task, photo = item['owner'],item['task_id'],item['photo_id']
                consent = self._consent(connection,owner,item['batch_id'])
                if not consent['granted'] or consent['version'] != item['consent_version']:
                    connection.execute("UPDATE photo_people_items SET status='cancelled',token=NULL,lease_until=NULL WHERE owner=? AND task_id=? AND status IN ('pending','running')",(owner,task))
                    connection.execute("UPDATE photo_people_tasks SET status='cancelled' WHERE owner=? AND task_id=?",(owner,task))
                    continue
                media = connection.execute('SELECT thumbnail FROM photo_media WHERE owner=? AND photo_id=?',(owner,photo)).fetchone()
                error = ('lease_exhausted' if item['attempts'] >= MAX_ATTEMPTS else
                         'model_changed' if item['fingerprint'] != FINGERPRINT else
                         'source_changed' if not media or hashlib.sha256(media[0]).hexdigest() != item['image_hash'] else None)
                if error:
                    connection.execute("UPDATE photo_people_items SET status='failed',error_code=?,token=NULL,lease_until=NULL WHERE owner=? AND task_id=? AND photo_id=?",(error,owner,task,photo))
                    self._summarize(connection,owner,task)
                    continue
                token = str(uuid.uuid4())
                connection.execute("UPDATE photo_people_items SET status='running',token=?,lease_until=?,attempts=attempts+1 WHERE owner=? AND task_id=? AND photo_id=?",(token,self.clock()+LEASE_SECONDS,owner,task,photo))
                connection.execute("UPDATE photo_people_tasks SET status='running' WHERE owner=? AND task_id=?",(owner,task))
                return PeopleClaim(owner,task,photo,token,FINGERPRINT,media[0])
            return None

    def check_people_claim(self, claim):
        with self._connection() as connection:
            self._validate_claim(connection,claim)

    def renew_people_claim(self, claim):
        with self._connection(write=True) as connection:
            self._validate_claim(connection,claim)
            connection.execute('UPDATE photo_people_items SET lease_until=? WHERE owner=? AND task_id=? AND photo_id=?',(self.clock()+LEASE_SECONDS,claim.owner,claim.task_id,claim.photo_id))

    def finish_people_item(self, claim, observations=(), *, error_code=None):
        if error_code not in (None,'invalid_model_output','inference_failed'):
            raise ValueError('Unsupported safe error code')
        if error_code and observations:
            raise ValueError('Failed item cannot have faces')
        if len(observations)>MAX_FACES:
            raise ValueError('Too many face observations')
        # Revalidate even frozen instances before persisting, never trust worker output.
        payloads = [json.dumps(asdict(FaceObservation(**asdict(face))),allow_nan=False) for face in observations]
        with self._connection(write=True) as connection:
            self._validate_claim(connection,claim)
            for index, payload in enumerate(payloads):
                connection.execute('INSERT INTO photo_people_faces VALUES (?,?,?,?,?)',(claim.owner,claim.task_id,claim.photo_id,claim.photo_id+'-'+str(index),payload))
            status = 'failed' if error_code else 'detected' if payloads else 'no_faces'
            connection.execute('UPDATE photo_people_items SET status=?,face_count=?,error_code=?,token=NULL,lease_until=NULL WHERE owner=? AND task_id=? AND photo_id=?',(status,len(payloads),error_code,claim.owner,claim.task_id,claim.photo_id))
            self._summarize(connection,claim.owner,claim.task_id)

    def process_people_item(self, engine):
        claim = self.claim_people_item()
        if claim is None:
            return False
        try:
            self.check_people_claim(claim)
            try:
                observations = engine.analyze_thumbnail(claim.thumbnail)
            except ValueError:
                self.finish_people_item(claim,error_code='invalid_model_output')
            except Exception:
                self.finish_people_item(claim,error_code='inference_failed')
            else:
                try:
                    self.finish_people_item(claim,observations)
                except (ValueError, TypeError):
                    self.finish_people_item(claim,error_code='invalid_model_output')
        except (PeopleConsentRequired, OperationConflict):
            # Another authorization or lease owns the outcome. Never add a fallback write.
            pass
        return True
