"""Task-local face suggestions and explicit user-confirmed person memberships."""

import hashlib
import json
import uuid

from .people_tasks import PhotoPeopleStore, PeopleConsentRequired, FINGERPRINT
from .date_store import OperationConflict, PhotoNotAvailable
from .faces import FaceObservation, CandidateFace, candidate_groups


class PhotoPeopleReviewStore(PhotoPeopleStore):
    def people_tasks(self, owner, batch):
        with self._connection() as connection:
            self._batch(connection,owner,batch)
            rows=connection.execute('SELECT task_id FROM photo_people_tasks WHERE owner=? AND batch_id=? ORDER BY created_at DESC,task_id LIMIT 20',(owner,batch)).fetchall()
            return [self._result(connection,owner,row[0]) for row in rows]

    def _group_snapshot(self, connection, owner, task):
        row=self._people_task(connection,owner,task)
        consent=self._consent(connection,owner,row['batch_id'])
        if not consent['granted'] or consent['version']!=row['consent_version']:
            raise PeopleConsentRequired('Current task consent required')
        if row['status'] not in ('needs_review','partial_failed') or row['fingerprint']!=FINGERPRINT:
            raise OperationConflict('Detection task not ready')
        faces=[dict(face) for face in connection.execute(
            'SELECT face_id,photo_id,observation FROM photo_people_faces WHERE owner=? AND task_id=? ORDER BY face_id',(owner,task))]
        digest=hashlib.sha256(json.dumps(dict(version=consent['version'],faces=faces),sort_keys=True).encode()).hexdigest()
        return faces,digest

    def prepare_people_candidates(self, owner, task):
        # CPU grouping outside write lock. Snapshot is fenced again before commit.
        with self._connection() as connection:
            self._people_task(connection,owner,task)
            if connection.execute('SELECT 1 FROM photo_people_group_runs WHERE owner=? AND task_id=?',(owner,task)).fetchone():
                return False
            rows,digest=self._group_snapshot(connection,owner,task)
        faces=[]
        members={}
        for row in rows:
            payload=json.loads(row['observation'])
            observation=FaceObservation(tuple(payload['box']),payload['score'],tuple(payload['feature']))
            faces.append(CandidateFace(row['face_id'],row['photo_id'],observation))
            members[row['face_id']]=dict(face_id=row['face_id'],photo_id=row['photo_id'],box=payload['box'])
        groups=candidate_groups(faces)
        with self._connection(write=True) as connection:
            _,current=self._group_snapshot(connection,owner,task)
            if current!=digest:
                raise OperationConflict('Detection snapshot changed')
            if connection.execute('SELECT 1 FROM photo_people_group_runs WHERE owner=? AND task_id=?',(owner,task)).fetchone():
                return False
            for group in groups:
                group_id=str(uuid.uuid4())
                connection.execute("INSERT INTO photo_people_groups VALUES (?,?,?,?,1,'pending',NULL)",
                    (owner,task,group_id,json.dumps([members[face] for face in group])))
            connection.execute('INSERT INTO photo_people_group_runs VALUES (?,?,?)',(owner,task,digest))
            return True

    def prepare_next_people_candidates(self):
        with self._connection() as connection:
            # Ignore revoked historic tasks; a new authorization never revives them.
            row=connection.execute("SELECT t.owner,t.task_id FROM photo_people_tasks t JOIN photo_people_consents c ON c.owner=t.owner AND c.batch_id=t.batch_id WHERE t.status IN ('needs_review','partial_failed') AND c.granted=1 AND c.version=t.consent_version AND t.fingerprint=? AND NOT EXISTS (SELECT 1 FROM photo_people_group_runs g WHERE g.owner=t.owner AND g.task_id=t.task_id) ORDER BY t.created_at LIMIT 1",(FINGERPRINT,)).fetchone()
        if row is None:
            return False
        try:
            return self.prepare_people_candidates(row['owner'],row['task_id'])
        except (PeopleConsentRequired,OperationConflict):
            return True

    def people_groups(self, owner, task):
        with self._connection() as connection:
            self._people_task(connection,owner,task)
            ready=bool(connection.execute('SELECT 1 FROM photo_people_group_runs WHERE owner=? AND task_id=?',(owner,task)).fetchone())
            rows=connection.execute('SELECT group_id,revision,status,members,person_id FROM photo_people_groups WHERE owner=? AND task_id=? ORDER BY group_id',(owner,task)).fetchall()
            return dict(ready=ready,groups=[{**dict(row),'members':json.loads(row['members'])} for row in rows])

    def review_people_group(self, owner, group, actor, *, operation_id, expected_revision,
                            consent_version, action, label=''):
        label=label.strip()
        if (action not in ('confirm','split','defer') or not actor or not operation_id
                or len(label)>80 or (action!='confirm' and label)):
            raise ValueError('Invalid person review')
        request=json.dumps(dict(actor=actor,expected_revision=expected_revision,consent_version=consent_version,action=action,label=label),sort_keys=True)
        with self._connection(write=True) as connection:
            row=connection.execute('SELECT * FROM photo_people_groups WHERE owner=? AND group_id=?',(owner,group)).fetchone()
            if not row:
                raise PhotoNotAvailable('Candidate unavailable')
            task=self._people_task(connection,owner,row['task_id'])
            consent=self._consent(connection,owner,task['batch_id'])
            if (not consent['granted'] or consent['version']!=consent_version
                    or task['consent_version']!=consent_version):
                raise PeopleConsentRequired('Current people consent required')
            previous=connection.execute('SELECT request,result FROM photo_people_review_events WHERE owner=? AND group_id=? AND operation_id=?',(owner,group,operation_id)).fetchone()
            if previous:
                if previous['request']!=request:
                    raise OperationConflict('Review operation changed')
                return json.loads(previous['result'])
            if row['revision']!=expected_revision or row['status'] not in ('pending','deferred'):
                raise OperationConflict('Candidate revision changed')
            members=json.loads(row['members'])
            person=None
            if action=='confirm':
                person=str(uuid.uuid4())
                connection.execute('INSERT INTO photo_people_persons VALUES (?,?,?,?,?)',(owner,person,label,actor,self.clock()))
                connection.executemany('INSERT INTO photo_people_members VALUES (?,?,?,?,?,?)',
                    [(owner,person,row['task_id'],member['face_id'],member['photo_id'],json.dumps(member['box'])) for member in members])
            elif action=='split':
                if len(members)<2:
                    raise ValueError('Single face cannot split')
                for member in members:
                    connection.execute("INSERT INTO photo_people_groups VALUES (?,?,?,?,1,'pending',NULL)",(owner,row['task_id'],str(uuid.uuid4()),json.dumps([member])))
            status={'confirm':'confirmed','defer':'deferred','split':'split'}[action]
            revision=row['revision']+1
            connection.execute('UPDATE photo_people_groups SET status=?,revision=?,person_id=? WHERE owner=? AND group_id=?',(status,revision,person,owner,group))
            result=dict(group_id=group,revision=revision,status=status,person_id=person)
            connection.execute('INSERT INTO photo_people_review_events VALUES (?,?,?,?,?,?,?)',(owner,group,operation_id,request,actor,json.dumps(result),self.clock()))
            return result

    def people_albums(self, owner, *, after_id='', limit=20):
        if not 1<=limit<=100:
            raise ValueError('Invalid album page')
        with self._connection() as connection:
            rows=connection.execute('SELECT p.person_id,p.label,COUNT(DISTINCT m.photo_id) AS photo_count FROM photo_people_persons p JOIN photo_people_members m ON m.owner=p.owner AND m.person_id=p.person_id WHERE p.owner=? AND p.person_id>? GROUP BY p.person_id ORDER BY p.person_id LIMIT ?',(owner,after_id,limit+1)).fetchall()
            return dict(people=[dict(row) for row in rows[:limit]],next_after_id=rows[limit-1]['person_id'] if len(rows)>limit else None)

    def person_photos(self, owner, person, *, after_id='', limit=20):
        if not 1<=limit<=100:
            raise ValueError('Invalid person photo page')
        with self._connection() as connection:
            if not connection.execute('SELECT 1 FROM photo_people_persons WHERE owner=? AND person_id=?',(owner,person)).fetchone():
                raise PhotoNotAvailable('Person unavailable')
            ids=[row[0] for row in connection.execute('SELECT DISTINCT photo_id FROM photo_people_members WHERE owner=? AND person_id=? AND photo_id>? ORDER BY photo_id LIMIT ?',(owner,person,after_id,limit+1))]
            photos=[]
            for photo in ids[:limit]:
                boxes=[json.loads(row[0]) for row in connection.execute('SELECT box FROM photo_people_members WHERE owner=? AND person_id=? AND photo_id=?',(owner,person,photo))]
                members=[dict(row) for row in connection.execute('SELECT task_id,face_id,box FROM photo_people_members WHERE owner=? AND person_id=? AND photo_id=? ORDER BY task_id,face_id',(owner,person,photo))]
                photos.append(dict(photo_id=photo,boxes=boxes,members=[{**m,'box':json.loads(m['box'])} for m in members]))
            return dict(photos=photos,next_after_id=ids[limit-1] if len(ids)>limit else None)
