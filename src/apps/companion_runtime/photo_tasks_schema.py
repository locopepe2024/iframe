TASK_SCHEMA = """
CREATE TABLE IF NOT EXISTS companion_turn_photo_requests (
 owner TEXT NOT NULL, operation_id TEXT NOT NULL, photo_id TEXT,
 PRIMARY KEY(owner,operation_id)
);
CREATE TABLE IF NOT EXISTS companion_photo_tasks (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, actor TEXT NOT NULL,
 session_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 status TEXT NOT NULL, step TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, UNIQUE(owner, actor, operation_id)
);
CREATE TABLE IF NOT EXISTS companion_photo_task_operations (
 owner TEXT NOT NULL, actor TEXT NOT NULL, task_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, request TEXT NOT NULL,
 UNIQUE(owner, actor, task_id, operation_id)
);
"""
