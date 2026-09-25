"""Durable owner-scoped extraction results, independent of browser connections."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from contextvars import copy_context
import json
import logging
from pathlib import Path
import sqlite3
from threading import Lock
import time
from uuid import uuid4

from fastapi import HTTPException

logger = logging.getLogger(__name__)
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix='script-extraction')
RETENTION = 86400
STORYBOARD_TIMEOUT = 30 * 60


class ExtractionJobs:
    def __init__(self, path='output/extraction-jobs.sqlite3', executor=None):
        self.path = Path(path)
        self.executor = executor or _POOL
        # LIFO/latest-wins Director refinement jobs are kept in memory until
        # dispatched. The durable row still makes status polling owner-scoped;
        # a process restart cannot resume an in-memory callable and will mark
        # such a queued row failed when it is encountered.
        self._pending_work = {}
        self._dispatch_lock = Lock()

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, result TEXT, error TEXT, superseded INTEGER NOT NULL DEFAULT 0, queue_group TEXT NOT NULL DEFAULT \'\')')
        # Existing installations predate the superseded marker. Keep the
        # migration local and additive so old durable results remain readable.
        try:
            db.execute('ALTER TABLE jobs ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        try:
            db.execute("ALTER TABLE jobs ADD COLUMN queue_group TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        db.execute('CREATE INDEX IF NOT EXISTS extraction_owner_project ON jobs(owner, project, fingerprint, created)')
        return db

    def recover_interrupted(self):
        """Close rows whose in-process workers disappeared on server restart."""
        with closing(self.connect()) as db, db:
            cursor = db.execute(
                "UPDATE jobs SET status='failed', result=NULL, error=? "
                "WHERE status IN ('running', 'queued')",
                ('分析任务因服务重启而中断，请重试。',),
            )
            return cursor.rowcount

    @staticmethod
    def _expire_storyboard_jobs(db, now):
        db.execute(
            "UPDATE jobs SET status='failed', result=NULL, error=? "
            "WHERE status='running' AND fingerprint LIKE 'storyboard:%' AND created<?",
            ('分镜分析超时，请重试。', now - STORYBOARD_TIMEOUT),
        )

    @staticmethod
    def public(row):
        superseded = bool(row['superseded']) if 'superseded' in row.keys() else False
        status = 'superseded' if superseded and row['status'] == 'running' else row['status']
        error = row['error']
        if status == 'superseded' and not error:
            error = '该修订已被更新的请求替代。'
        return {'id': row['id'], 'status': status,
                'result': json.loads(row['result']) if row['result'] and status != 'superseded' else None,
                'error': error}

    def start(self, owner, project, fingerprint, work, *, queue_policy='fifo', queue_group=''):
        if queue_policy not in ('fifo', 'lifo'):
            raise ValueError(f'Unknown extraction queue policy: {queue_policy}')
        if queue_policy == 'lifo':
            return self._start_lifo(owner, project, fingerprint, work, queue_group)
        now = time.time()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            self._expire_storyboard_jobs(db, now)
            db.execute("DELETE FROM jobs WHERE status!='running' AND created<?", (now - RETENTION,))
            prior = db.execute("SELECT * FROM jobs WHERE owner=? AND project=? AND fingerprint=? AND status IN ('running','completed') ORDER BY created DESC LIMIT 1", (owner, project, fingerprint)).fetchone()
            if prior:
                return self.public(prior)
            if db.execute("SELECT 1 FROM jobs WHERE owner=? AND project=? AND status='running'", (owner, project)).fetchone():
                raise HTTPException(409, '该项目仍在分析上一版剧本，请等待完成后重试。')
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0] >= 4:
                raise HTTPException(503, '分析任务繁忙，请稍后重试。')
            job_id = uuid4().hex
            db.execute('INSERT INTO jobs (id, owner, project, fingerprint, status, created, result, error, superseded, queue_group) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)',
                       (job_id, owner, project, fingerprint, 'running', now, queue_group))
        try:
            self.executor.submit(copy_context().run, self._run, job_id, work)
        except Exception:
            self._finish(job_id, error='分析任务未能启动，请重试。')
            raise HTTPException(503, '分析任务未能启动，请重试。')
        return {'id': job_id, 'status': 'running', 'result': None, 'error': None}

    def _start_lifo(self, owner, project, fingerprint, work, queue_group):
        """Queue a latest-wins job without changing other extraction flows."""
        now = time.time()
        job_id = uuid4().hex
        # Serialize insertion with dispatch. Otherwise another request can
        # observe the committed queued row in the small window before its
        # callable is placed in _pending_work and incorrectly mark it failed.
        with self._dispatch_lock:
            with closing(self.connect()) as db, db:
                db.execute('BEGIN IMMEDIATE')
                db.execute("DELETE FROM jobs WHERE status NOT IN ('running','queued') AND created<?", (now - RETENTION,))
                prior = db.execute(
                    "SELECT * FROM jobs WHERE owner=? AND project=? AND fingerprint=? "
                    "AND (status='queued' OR status='completed' OR (status='running' AND superseded=0)) "
                    "AND queue_group=? "
                    "ORDER BY created DESC, rowid DESC LIMIT 1",
                    (owner, project, fingerprint, queue_group),
                ).fetchone()
                if prior:
                    return self.public(prior)

                # A running worker cannot be force-killed safely. Mark it stale so
                # its eventual result is discarded; the new request waits behind
                # it, while any older queued request is removed from the LIFO set.
                db.execute(
                    "UPDATE jobs SET superseded=1, error=? "
                    "WHERE owner=? AND project=? AND queue_group=? AND status='running' AND superseded=0",
                    ('该修订已被更新的请求替代。', owner, project, queue_group),
                )
                db.execute(
                    "UPDATE jobs SET status='superseded', error=? "
                    "WHERE owner=? AND project=? AND queue_group=? AND status='queued'",
                    ('该修订已被更新的请求替代。', owner, project, queue_group),
                )
                db.execute(
                    'INSERT INTO jobs (id, owner, project, fingerprint, status, created, result, error, superseded, queue_group) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)',
                    (job_id, owner, project, fingerprint, 'queued', now, queue_group),
                )
            self._pending_work[job_id] = work
        self._dispatch_lifo()
        with closing(self.connect()) as db, db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            return self.public(row)

    def _dispatch_lifo(self):
        """Dispatch newest queued work while global worker capacity exists."""
        with self._dispatch_lock:
            while True:
                work = None
                job_id = None
                with closing(self.connect()) as db, db:
                    db.execute('BEGIN IMMEDIATE')
                    active = db.execute(
                        "SELECT COUNT(*) FROM jobs WHERE status='running'"
                    ).fetchone()[0]
                    if active >= 4:
                        return
                    row = db.execute(
                        "SELECT q.* FROM jobs q "
                        "WHERE q.status='queued' "
                        "AND NOT EXISTS ("
                        "SELECT 1 FROM jobs r "
                        "WHERE r.status='running' "
                        "AND r.owner=q.owner AND r.project=q.project "
                        "AND r.queue_group=q.queue_group"
                        ") "
                        "ORDER BY q.created DESC, q.rowid DESC LIMIT 1"
                    ).fetchone()
                    if not row:
                        return
                    job_id = row['id']
                    work = self._pending_work.get(job_id)
                    if work is None:
                        db.execute(
                            "UPDATE jobs SET status='failed', error=? WHERE id=? AND status='queued'",
                            ('分析任务无法恢复，请重试。', job_id),
                        )
                        continue
                    db.execute(
                        "UPDATE jobs SET status='running' WHERE id=? AND status='queued'",
                        (job_id,),
                    )
                try:
                    self.executor.submit(copy_context().run, self._run, job_id, work)
                except Exception:
                    self._finish(job_id, error='分析任务未能启动，请重试。')

    def _dispatch_after_finish(self):
        try:
            self._dispatch_lifo()
        except Exception:
            logger.exception('Failed to dispatch queued latest-wins extraction job')

    def _finish(self, job_id, result=None, error=None):
        encoded = json.dumps(result, ensure_ascii=False) if result is not None else None
        with closing(self.connect()) as db, db:
            row = db.execute(
                "SELECT status, superseded FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
            if row and row['status'] == 'running':
                stale = bool(row['superseded'])
                db.execute(
                    "UPDATE jobs SET status=?, result=?, error=? WHERE id=? AND status='running'",
                    ('superseded' if stale else ('failed' if error else 'completed'),
                     None if stale else encoded,
                     '该修订已被更新的请求替代。' if stale else error,
                     job_id),
                )
        self._pending_work.pop(job_id, None)
        self._dispatch_after_finish()

    def _run(self, job_id, work):
        try:
            self._finish(job_id, result=work())
        except Exception as exc:
            logger.error('Script extraction %s failed (%s)', job_id, type(exc).__name__)
            self._finish(job_id, error='剧本分析失败，请检查模型配置后重试。')

    def get(self, owner, project, job_id):
        with closing(self.connect()) as db, db:
            self._expire_storyboard_jobs(db, time.time())
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=? AND project=?', (job_id, owner, project)).fetchone()
            if not row:
                raise HTTPException(404, 'Analysis task not found')
            return self.public(row)

    def forget_result(self, owner, project, key, value):
        """Remove completed jobs whose JSON result contains an exact key/value."""
        with closing(self.connect()) as db, db:
            rows = db.execute(
                "SELECT id, result FROM jobs WHERE owner=? AND project=? AND status='completed'",
                (owner, project),
            ).fetchall()
            matches = []
            for row in rows:
                try:
                    result = json.loads(row['result']) if row['result'] else {}
                except json.JSONDecodeError:
                    continue
                if isinstance(result, dict) and result.get(key) == value:
                    matches.append((row['id'],))
            if matches:
                db.executemany("DELETE FROM jobs WHERE id=?", matches)
