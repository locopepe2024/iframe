"""Independent person-analysis consent, leases and derived detections."""

PEOPLE_SCHEMA = """
CREATE TABLE IF NOT EXISTS photo_people_consents (
 owner TEXT NOT NULL, batch_id TEXT NOT NULL, version INTEGER NOT NULL,
 granted INTEGER NOT NULL CHECK(granted IN (0,1)),
 PRIMARY KEY(owner,batch_id)
);
CREATE TABLE IF NOT EXISTS photo_people_questions (
 owner TEXT NOT NULL, batch_id TEXT NOT NULL, question_id TEXT NOT NULL,
 version INTEGER NOT NULL, expires REAL NOT NULL, disclosure TEXT NOT NULL,
 PRIMARY KEY(owner,batch_id)
);
CREATE TABLE IF NOT EXISTS photo_people_consent_events (
 owner TEXT NOT NULL, batch_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 request TEXT NOT NULL, version INTEGER NOT NULL, granted INTEGER NOT NULL,
 actor TEXT NOT NULL, created_at REAL NOT NULL, cleared INTEGER NOT NULL,
 PRIMARY KEY(owner,batch_id,operation_id)
);
CREATE TABLE IF NOT EXISTS photo_people_tasks (
 owner TEXT NOT NULL, task_id TEXT NOT NULL, batch_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, actor TEXT NOT NULL, consent_version INTEGER NOT NULL,
 fingerprint TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL,
 created_at REAL NOT NULL,
 PRIMARY KEY(owner,task_id), UNIQUE(owner,batch_id,operation_id)
);
CREATE TABLE IF NOT EXISTS photo_people_items (
 owner TEXT NOT NULL, task_id TEXT NOT NULL, photo_id TEXT NOT NULL,
 image_hash TEXT NOT NULL, status TEXT NOT NULL, token TEXT,
 lease_until REAL, attempts INTEGER NOT NULL, face_count INTEGER NOT NULL,
 error_code TEXT,
 PRIMARY KEY(owner,task_id,photo_id),
 FOREIGN KEY(owner,task_id) REFERENCES photo_people_tasks(owner,task_id)
);
CREATE TABLE IF NOT EXISTS photo_people_faces (
 owner TEXT NOT NULL, task_id TEXT NOT NULL, photo_id TEXT NOT NULL,
 face_id TEXT NOT NULL, observation TEXT NOT NULL,
 PRIMARY KEY(owner,task_id,face_id),
 FOREIGN KEY(owner,task_id,photo_id) REFERENCES photo_people_items(owner,task_id,photo_id)
);
CREATE INDEX IF NOT EXISTS photo_people_pending ON photo_people_items(status,lease_until);
"""

PEOPLE_SCHEMA += """
CREATE TABLE IF NOT EXISTS photo_people_group_runs (
 owner TEXT NOT NULL, task_id TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(owner,task_id)
);
CREATE TABLE IF NOT EXISTS photo_people_groups (
 owner TEXT NOT NULL, task_id TEXT NOT NULL, group_id TEXT NOT NULL,
 members TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
 person_id TEXT,
 PRIMARY KEY(owner,group_id),
 FOREIGN KEY(owner,task_id) REFERENCES photo_people_tasks(owner,task_id)
);
CREATE TABLE IF NOT EXISTS photo_people_persons (
 owner TEXT NOT NULL, person_id TEXT NOT NULL, label TEXT NOT NULL,
 actor TEXT NOT NULL, created_at REAL NOT NULL,
 PRIMARY KEY(owner,person_id)
);
CREATE TABLE IF NOT EXISTS photo_people_members (
 owner TEXT NOT NULL, person_id TEXT NOT NULL, task_id TEXT NOT NULL,
 face_id TEXT NOT NULL, photo_id TEXT NOT NULL, box TEXT NOT NULL,
 PRIMARY KEY(owner,task_id,face_id),
 FOREIGN KEY(owner,person_id) REFERENCES photo_people_persons(owner,person_id)
);
CREATE TABLE IF NOT EXISTS photo_people_review_events (
 owner TEXT NOT NULL, group_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 request TEXT NOT NULL, actor TEXT NOT NULL, result TEXT NOT NULL,
 created_at REAL NOT NULL,
 PRIMARY KEY(owner,group_id,operation_id)
);
"""
