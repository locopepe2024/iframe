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
from .llm import DirectorShootingChunkError
from .llm_adapter import LLM_CONTENT_REFUSAL_FINISH_REASONS

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
        db.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, result TEXT, error TEXT, superseded INTEGER NOT NULL DEFAULT 0, queue_group TEXT NOT NULL DEFAULT \'\', total_batches INTEGER NOT NULL DEFAULT 0)')
        # Existing installations predate the superseded marker. Keep the
        # migration local and additive so old durable results remain readable.
        try:
            db.execute('ALTER TABLE jobs ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        try:
            db.execute('ALTER TABLE jobs ADD COLUMN total_batches INTEGER NOT NULL DEFAULT 0')
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        try:
            db.execute("ALTER TABLE jobs ADD COLUMN queue_group TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError as exc:
            if 'duplicate column name' not in str(exc).lower():
                raise
        db.execute('CREATE INDEX IF NOT EXISTS extraction_owner_project ON jobs(owner, project, fingerprint, created)')
        db.execute('CREATE TABLE IF NOT EXISTS storyboard_batches (owner TEXT NOT NULL, project TEXT NOT NULL, fingerprint TEXT NOT NULL, batch_index INTEGER NOT NULL, source_ref TEXT NOT NULL, frames TEXT NOT NULL, PRIMARY KEY(owner, project, fingerprint, batch_index))')
        return db

    def load_batches(self, owner, project, fingerprint):
        with closing(self.connect()) as db:
            rows = db.execute(
                'SELECT batch_index, source_ref, frames FROM storyboard_batches '
                'WHERE owner=? AND project=? AND fingerprint=? ORDER BY batch_index',
                (owner, project, fingerprint),
            ).fetchall()
            return {row['batch_index']: {'source_ref': row['source_ref'],
                                         'frames': json.loads(row['frames'])} for row in rows}

    def save_batch(self, owner, project, fingerprint, job_id, index, source_ref, frames):
        """Only an active worker may commit a batch; expired workers lose ownership."""
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            self._expire_storyboard_jobs(db, time.time())
            active = db.execute(
                "SELECT 1 FROM jobs WHERE id=? AND owner=? AND project=? AND fingerprint=? AND status='running' AND superseded=0",
                (job_id, owner, project, fingerprint),
            ).fetchone()
            if not active:
                return False
            db.execute(
                'INSERT INTO storyboard_batches (owner, project, fingerprint, batch_index, source_ref, frames) '
                'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner, project, fingerprint, batch_index) '
                'DO UPDATE SET source_ref=excluded.source_ref, frames=excluded.frames',
                (owner, project, fingerprint, index, source_ref, json.dumps(frames, ensure_ascii=False)),
            )
            return True

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
    def public(row, completed_batches=0, total_batches=None):
        superseded = bool(row['superseded']) if 'superseded' in row.keys() else False
        status = 'superseded' if superseded and row['status'] == 'running' else row['status']
        error = row['error']
        if status == 'superseded' and not error:
            error = '该修订已被更新的请求替代。'
        progress = ({'completed': completed_batches,
                     'total': total_batches if total_batches is not None else row['total_batches']}
                    if row['total_batches'] else None)
        if progress and row['fingerprint'].startswith(('director:', 'series-director:')):
            from .director_profile_stages import STAGES
            progress['stage'] = (STAGES[min(completed_batches, len(STAGES) - 1)][0]
                                 if completed_batches < progress['total'] else None)
        return {'id': row['id'], 'status': status,
                'progress': progress,
                'result': json.loads(row['result']) if row['result'] and status != 'superseded' else None,
                'error': error}

    @staticmethod
    def _progress(db, row):
        completed, total = 0, row['total_batches']
        if not total:
            return completed, total
        if not row['fingerprint'].startswith('director_shooting_plan:'):
            completed = db.execute(
                'SELECT COUNT(*) FROM storyboard_batches WHERE owner=? AND project=? AND fingerprint=?',
                (row['owner'], row['project'], row['fingerprint']),
            ).fetchone()[0]
            return completed, total
        batches = db.execute(
            'SELECT frames FROM storyboard_batches WHERE owner=? AND project=? AND fingerprint=?',
            (row['owner'], row['project'], row['fingerprint']),
        ).fetchall()
        for batch in batches:
            frames = json.loads(batch['frames'])
            checkpoint = frames.get('checkpoint') if isinstance(frames, dict) else None
            if isinstance(checkpoint, dict):
                expected = {f'{si}:{bi}' for si, scene in enumerate(checkpoint['structure']['scenes'])
                            for bi, _ in enumerate(scene['beats'])}
                total += len(expected)
                completed += 1 + len(expected.intersection(checkpoint['details']))
            elif isinstance(frames, dict) and frames.get('result'):
                completed += 1
        return completed, total

    def start(self, owner, project, fingerprint, work, *, queue_policy='fifo', queue_group='', pass_job_id=False, total_batches=0, reuse_running=False):
        if queue_policy not in ('fifo', 'lifo'):
            raise ValueError(f'Unknown extraction queue policy: {queue_policy}')
        if queue_policy == 'lifo':
            return self._start_lifo(owner, project, fingerprint, work, queue_group)
        now = time.time()
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            self._expire_storyboard_jobs(db, now)
            db.execute("DELETE FROM jobs WHERE status!='running' AND created<?", (now - RETENTION,))
            db.execute('DELETE FROM storyboard_batches WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.owner=storyboard_batches.owner AND jobs.project=storyboard_batches.project AND jobs.fingerprint=storyboard_batches.fingerprint)')
            prior = db.execute("SELECT * FROM jobs WHERE owner=? AND project=? AND fingerprint=? AND status IN ('running','completed') ORDER BY created DESC LIMIT 1", (owner, project, fingerprint)).fetchone()
            if prior:
                return self.public(prior, *self._progress(db, prior))
            if reuse_running:
                active = db.execute(
                    "SELECT * FROM jobs WHERE owner=? AND project=? AND status='running' ORDER BY created DESC LIMIT 1",
                    (owner, project),
                ).fetchone()
                if active:
                    return self.public(active, *self._progress(db, active))
            if db.execute("SELECT 1 FROM jobs WHERE owner=? AND project=? AND status='running'", (owner, project)).fetchone():
                raise HTTPException(409, '该项目仍在分析上一版剧本，请等待完成后重试。')
            active_limit = 64 if fingerprint.startswith('storyboard-render:') else 4
            if db.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0] >= active_limit:
                raise HTTPException(503, '分析任务繁忙，请稍后重试。')
            job_id = uuid4().hex
            db.execute('INSERT INTO jobs (id, owner, project, fingerprint, status, created, result, error, superseded, queue_group, total_batches) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)',
                       (job_id, owner, project, fingerprint, 'running', now, queue_group, total_batches))
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            completed, total = self._progress(db, row)
        try:
            self.executor.submit(copy_context().run, self._run, job_id, work, pass_job_id)
        except Exception:
            self._finish(job_id, error='分析任务未能启动，请重试。')
            raise HTTPException(503, '分析任务未能启动，请重试。')
        return self.public(row, completed, total)

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

    def _run(self, job_id, work, pass_job_id=False):
        try:
            self._finish(job_id, result=work(job_id) if pass_job_id else work())
        except Exception as exc:
            logger.error('Script extraction %s failed (%s)', job_id, type(exc).__name__)
            with closing(self.connect()) as db:
                row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
                completed, total = self._progress(db, row) if row else (0, 0)
            message = (
                '分镜分析失败；已完成的分段已保存，重试会从未完成段继续。'
                if row and row['fingerprint'].startswith('storyboard:')
                else '分镜图片渲染失败，请检查当前帧状态后重试。'
                if row and row['fingerprint'].startswith('storyboard-render:')
                else '导演拍摄计划分析失败；已完成的分段已保存，重试会从未完成段继续。'
                if row and row['fingerprint'].startswith('director_shooting_plan:')
                else '剧本分析失败，请检查模型配置后重试。'
            )
            if row and row['fingerprint'].startswith('director_shooting_plan:') and isinstance(exc, DirectorShootingChunkError):
                message = f'导演拍摄计划生成失败（{exc.category}）：{exc.public_reason}；请重试或调整本段内容。'
            shooting = bool(row and row['fingerprint'].startswith('director_shooting_plan:'))
            diagnostic = getattr(exc, 'llm_diagnostic', None)
            stage = getattr(exc, 'shooting_plan_failure', {})
            if shooting:
                if not isinstance(exc, DirectorShootingChunkError):
                    location = (f"第 {stage['chunk']}/{stage['chunks']} 段，" if stage.get('chunk') else '')
                    location += (f"场景 {stage['scene']} 节拍 {stage['beat']}，" if stage.get('scene') else '')
                    reason = '场景与节拍规划失败' if stage.get('stage') == 'structure' else '镜头生成失败'
                    if stage.get('stage') == 'finalize':
                        reason = '拍摄计划汇总校验失败'
                    if isinstance(diagnostic, dict):
                        reason = '模型请求失败'
                        if diagnostic.get('finish_reason') in LLM_CONTENT_REFUSAL_FINISH_REASONS:
                            reason = f"所选模型拒绝处理本次内容（{diagnostic['finish_reason']}），请调整输入或切换剧本模型"
                        elif diagnostic.get('finish_reason') == 'length':
                            reason = '模型输出达到长度上限（length），本步骤未完整生成'
                        elif diagnostic.get('stream') and diagnostic.get('text_chars'):
                            reason = '模型流式响应中断'
                    message = f'导演拍摄计划生成失败：{location}{reason}。'
                message += (f'已保存 {completed}/{total} 个生成步骤，重试将复用有效结果并重新校验汇总。'
                            if completed and completed >= total else
                            f'已保存 {completed}/{total} 个步骤，重试会继续未完成部分。'
                            if completed else '尚无已完成步骤，请重试。')
            if row and row['project'].startswith(('script-outline:document:', 'script-writing:')):
                detail = str(exc).strip()
                label = '总纲解析' if row['project'].startswith('script-outline:') else '剧本写作'
                if 'timed out' in detail.lower() or 'timeout' in detail.lower() or 'status=524' in detail:
                    message = f'{label}请求超时，请稍后重试；已保存的内容不会受影响。'
                elif detail:
                    message = f'{label}失败：{detail[:300]}'
            elif row and not row['fingerprint'].startswith(('storyboard:', 'director_shooting_plan:')):
                detail = str(exc).strip()
                is_director = row['fingerprint'].startswith(('director:', 'series-director:'))
                label = '导演分析' if is_director else '实体提取'
                if 'timed out' in detail.lower() or 'timeout' in detail.lower():
                    message = ('导演分析请求超时；请稍后重试，已保留当前 Director 草稿。' if is_director
                               else '实体提取请求超时，请稍后重试；已有资产不会受影响。')
                elif detail:
                    message = f'{label}失败：{detail[:300]}'
            director_stage = getattr(exc, 'director_profile_failure', None)
            if director_stage:
                from .director_profile_stages import STAGES
                label = next((label for key, label, _ in STAGES if key == director_stage), '导演设定')
                category = getattr(exc, 'director_profile_failure_category', '')
                if category == 'checkpoint':
                    reason = '输入已改变或任务已失效，请重新生成'
                elif category == 'parse':
                    reason = '模型返回的 JSON 不完整、无效或超过本步骤预算'
                elif isinstance(diagnostic, dict):
                    reason = '模型流式响应中断' if diagnostic.get('stream') else '模型请求失败'
                    if diagnostic.get('finish_reason') == 'length':
                        reason = '模型输出达到长度上限，本步骤未完整生成'
                    elif diagnostic.get('finish_reason') in LLM_CONTENT_REFUSAL_FINISH_REASONS:
                        reason = f"所选模型拒绝处理本次内容（{diagnostic['finish_reason']}），请调整输入或切换剧本模型"
                else:
                    reason = '返回格式或引用校验未通过，请重试或切换剧本模型'
                message = f'导演分析失败：{label}步骤，{reason}。'
                message += (f'已保存 {completed}/{total} 个步骤，重试会从未完成步骤继续。'
                            if completed else '尚无已完成步骤，请重试。')
            # Preserve bounded Director evidence even when admission/validation
            # rejects the structured profile. This is deliberately stored in
            # the owner-scoped job row, never emitted to ordinary logs.
            audit = getattr(exc, "director_audit", None)
            failure_result = None
            if shooting:
                failure_result = {'failure_stage': stage}
                contract = getattr(exc, 'shooting_contract_diagnostic', None)
                if isinstance(contract, dict):
                    failure_result['contract_diagnostic'] = contract
                if isinstance(diagnostic, dict):
                    failure_result['provider_response'] = diagnostic
            if isinstance(audit, dict):
                failure_result = {
                    "source_audit": audit,
                    "failure_stage": audit.get("failure_stage", "admission"),
                    "failure_detail": str(exc)[:1000],
                }
            self._finish(job_id, result=failure_result, error=message)

    def get(self, owner, project, job_id):
        with closing(self.connect()) as db, db:
            self._expire_storyboard_jobs(db, time.time())
            row = db.execute('SELECT * FROM jobs WHERE id=? AND owner=? AND project=?', (job_id, owner, project)).fetchone()
            if not row:
                raise HTTPException(404, 'Analysis task not found')
            completed, total = self._progress(db, row)
            return self.public(row, completed, total)

    def get_for_project_prefix(self, owner, project_prefix, job_id, fingerprint_prefix):
        with closing(self.connect()) as db:
            row = db.execute(
                'SELECT * FROM jobs WHERE id=? AND owner=? AND project LIKE ? AND fingerprint LIKE ?',
                (job_id, owner, project_prefix + ':%', fingerprint_prefix + '%'),
            ).fetchone()
            if not row:
                raise HTTPException(404, 'Render task not found')
            return self.public(row)

    def latest_for_project(self, owner, project, fingerprint_prefix):
        with closing(self.connect()) as db:
            row = db.execute(
                'SELECT * FROM jobs WHERE owner=? AND project=? AND fingerprint LIKE ? '
                'ORDER BY created DESC, rowid DESC LIMIT 1',
                (owner, project, fingerprint_prefix + '%'),
            ).fetchone()
            if not row:
                raise HTTPException(404, '没有可读取的优化任务，请先提交 AI 完善。')
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
