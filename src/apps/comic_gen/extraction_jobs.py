"""Durable owner-scoped extraction results, independent of browser connections."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from contextvars import copy_context
import json
import logging
from pathlib import Path
import sqlite3
import time
from uuid import uuid4

from fastapi import HTTPException

logger = logging.getLogger(__name__)
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix='script-extraction')
RETENTION = 86400


class ExtractionJobs:
    def __init__(self, path='output/extraction-jobs.sqlite3', executor=None):
        self.path = Path(path)
        self.executor = executor or _POOL

    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, result TEXT, error TEXT)')
        db.execute('CREATE INDEX IF NOT EXISTS extraction_owner_project ON jobs(owner, project, fingerprint, created)')
        return db

    @staticmethod
    def public(row):
        return {'id': row['id'], 'status': row['status'],
                'result': json.loads(row['result']) if row['result'] else None, 'error': row['error']}

    def start(self, owner, project, fingerprint, work):
        now = time.time()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("DELETE FROM jobs WHERE status!='running' AND created<?", (now - RETENTION,))
            prior = db.execute("SELECT * FROM jobs WHERE owner=? AND project=? AND fingerprint=? AND status IN ('running','completed') ORDER BY created DESC LIMIT 1", (owner, project, fingerprint)).fetchone()
            if prior:
                return self.public(prior)
            if db.execute("SELECT 1 FROM jobs WHERE owner=? AND project=? AND status='running'", (owner, project)).fetchone():
                raise HTTPException(409, '该项目仍在分析上一版剧本，请等待完成后重试。')
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0] >= 4:
                raise HTTPException(503, '分析任务繁忙，请稍后重试。')
            job_id = uuid4().hex
            db.execute('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
                       (job_id, owner, project, fingerprint, 'running', now))
        try:
            self.executor.submit(copy_context().run, self._run, job_id, work)
        except Exception:
            self._finish(job_id, error='分析任务未能启动，请重试。')
            raise HTTPException(503, '分析任务未能启动，请重试。')
        return {'id': job_id, 'status': 'running', 'result': None, 'error': None}

    def _finish(self, job_id, result=None, error=None):
        encoded = json.dumps(result, ensure_ascii=False) if result is not None else None
        with closing(self.connect()) as db, db:
            db.execute("UPDATE jobs SET status=?, result=?, error=? WHERE id=? AND status='running'",
                       ('failed' if error else 'completed', encoded, error, job_id))

    def _run(self, job_id, work):
        try:
            self._finish(job_id, result=work())
        except Exception as exc:
            logger.error('Script extraction %s failed (%s)', job_id, type(exc).__name__)
            self._finish(job_id, error='剧本分析失败，请检查模型配置后重试。')

    def get(self, owner, project, job_id):
        with closing(self.connect()) as db, db:
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=? AND project=?', (job_id, owner, project)).fetchone()
            if not row:
                raise HTTPException(404, 'Analysis task not found')
            return self.public(row)
