"""Isolated SQLite operation journal. Not wired to live companion APIs.

Only trusted local adapters may supply mutation callbacks. They must use the
provided connection, never commit, perform network IO or other external effects.
Identity is supplied by an authenticated caller, never by model arguments.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3

from .operation_protocol import Receipt, advance, resolve_wait, request_cancel


class Conflict(ValueError):
    pass


class Missing(LookupError):
    pass


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


SCHEMA = '''
CREATE TABLE IF NOT EXISTS operation_tasks (
 owner TEXT NOT NULL, session TEXT NOT NULL, task TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL,
 PRIMARY KEY(owner,session,task)
);
CREATE TABLE IF NOT EXISTS operations (
 owner TEXT NOT NULL, session TEXT NOT NULL, operation TEXT NOT NULL,
 task TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL,
 PRIMARY KEY(owner,session,operation),
 FOREIGN KEY(owner,session,task) REFERENCES operation_tasks(owner,session,task)
);
CREATE INDEX IF NOT EXISTS operations_task ON operations(owner,session,task);
CREATE TABLE IF NOT EXISTS operation_commands (
 owner TEXT NOT NULL, session TEXT NOT NULL, operation TEXT NOT NULL,
 command TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL,
 PRIMARY KEY(owner,session,operation,command),
 FOREIGN KEY(owner,session,operation) REFERENCES operations(owner,session,operation)
);
CREATE TABLE IF NOT EXISTS operation_events (
 cursor INTEGER PRIMARY KEY AUTOINCREMENT,
 owner TEXT NOT NULL, session TEXT NOT NULL, operation TEXT NOT NULL,
 receipt TEXT NOT NULL,
 FOREIGN KEY(owner,session,operation) REFERENCES operations(owner,session,operation)
);
CREATE INDEX IF NOT EXISTS operation_events_stream ON operation_events(owner,session,cursor);
'''


class OperationStore:
    def __init__(self, path, *, initialize=False):
        self.path = Path(path)
        if not self.path.is_absolute():
            raise ValueError('Explicit absolute database path required')
        if initialize:
            with sqlite3.connect(self.path) as db:
                db.executescript(SCHEMA)

    @contextmanager
    def connection(self, *, write=False):
        db = sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=5)
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
    def _task(db, owner, session, task):
        row = db.execute('SELECT * FROM operation_tasks WHERE owner=? AND session=? AND task=?',
                         (owner, session, task)).fetchone()
        if row is None:
            raise Missing('Task not found')
        return dict(task_id=row['task'], revision=row['revision'], payload=json.loads(row['payload']))

    @staticmethod
    def _operation(db, owner, session, operation):
        row = db.execute('SELECT receipt FROM operations WHERE owner=? AND session=? AND operation=?',
                         (owner, session, operation)).fetchone()
        if row is None:
            raise Missing('Operation not found')
        return Receipt.model_validate_json(row['receipt'])

    @staticmethod
    def _event(db, owner, session, receipt):
        db.execute('INSERT INTO operation_events(owner,session,operation,receipt) VALUES (?,?,?,?)',
                   (owner, session, receipt.operation_id, receipt.model_dump_json()))

    def create_task(self, owner, session, task, payload):
        # Bootstrap for the isolated repository, not a model-facing task creator.
        with self.connection(write=True) as db:
            db.execute('INSERT INTO operation_tasks VALUES (?,?,?,?,?)',
                       (owner, session, task, 1, encode(payload)))

    def task(self, owner, session, task):
        with self.connection() as db:
            return self._task(db, owner, session, task)

    def get(self, owner, session, operation):
        with self.connection() as db:
            return self._operation(db, owner, session, operation)

    def get_call(self, owner, session, operation):
        """Immutable invocation metadata, scoped like its receipt."""
        with self.connection() as db:
            row = db.execute('SELECT request FROM operations WHERE owner=? AND session=? AND operation=?',
                             (owner, session, operation)).fetchone()
            if row is None:
                raise Missing('Operation not found')
            return json.loads(row['request'])

    def wait_descriptor(self, owner, session, operation, wait_id):
        """Read a prior wait for payload validation on resume retries."""
        with self.connection() as db:
            self._operation(db, owner, session, operation)
            rows = db.execute('SELECT receipt FROM operation_commands WHERE owner=? AND session=? AND operation=? ORDER BY rowid DESC',
                              (owner, session, operation))
            for row in rows:
                wait = json.loads(row['receipt']).get('wait')
                if wait and wait['wait_id'] == wait_id:
                    return wait
            raise ValueError('Wait not found')

    def accept(self, owner, session, operation, task, expected_revision, tool, arguments):
        request = encode(dict(task=task, revision=expected_revision, tool=tool, arguments=arguments))
        with self.connection(write=True) as db:
            existing = db.execute('SELECT request,receipt FROM operations WHERE owner=? AND session=? AND operation=?',
                                  (owner, session, operation)).fetchone()
            if existing:
                if existing['request'] != request:
                    raise Conflict('Operation key reused with different input')
                return Receipt.model_validate_json(existing['receipt'])
            state = self._task(db, owner, session, task)
            if state['revision'] != expected_revision:
                raise Conflict('Task revision changed')
            receipt = Receipt(operation_id=operation, task_id=task, revision=state['revision'])
            db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?)',
                       (owner, session, operation, task, request, receipt.model_dump_json()))
            self._event(db, owner, session, receipt)
            return receipt

    def change(self, owner, session, operation, command, expected_seq, expected_revision,
               status, *, result=None, error=None, wait=None, external_job_id=None,
               wait_response=None, business_input=None, mutate=None):
        """Apply a worker command once and journal its receipt in one transaction.

        Mutation callback identity is not an idempotency key: the trusted adapter
        must provide its full semantic inputs in business_input. Replays return
        the saved command receipt even if the operation has since advanced.
        """
        if not command.strip():
            raise ValueError('Command key required')
        if mutate is not None and business_input is None:
            raise ValueError('Mutation semantic inputs required for deduplication')
        request = encode(dict(expected_seq=expected_seq, expected_revision=expected_revision,
                              status=status, result=result, error=error, wait=wait,
                              external_job_id=external_job_id, wait_response=wait_response,
                              business_input=business_input, has_mutation=mutate is not None))
        with self.connection(write=True) as db:
            previous = db.execute('SELECT request,receipt FROM operation_commands WHERE owner=? AND session=? AND operation=? AND command=?',
                                  (owner, session, operation, command)).fetchone()
            if previous:
                if previous['request'] != request:
                    raise Conflict('Command key reused with different input')
                return Receipt.model_validate_json(previous['receipt'])
            current = self._operation(db, owner, session, operation)
            state = self._task(db, owner, session, current.task_id)
            if (current.event_seq != expected_seq or current.revision != expected_revision
                    or state['revision'] != expected_revision):
                raise Conflict('Operation or task changed')
            if current.status == 'waiting_user' and status == 'running':
                if wait_response is None:
                    raise ValueError('User response required to resume')
                next_receipt = resolve_wait(current, expected_revision=expected_revision, **wait_response)
                if any(value is not None for value in (result, error, wait, external_job_id)):
                    raise ValueError('Wait response cannot inject output fields')
            elif wait_response is not None:
                raise ValueError('Unexpected wait response')
            elif status == 'cancel_request':
                if any(value is not None for value in (result, error, wait, external_job_id, mutate)):
                    raise ValueError('Cancellation request cannot mutate business state')
                next_receipt = request_cancel(current)
            else:
                next_receipt = advance(current, status, result=result, error=error,
                                       wait=wait, external_job_id=external_job_id)
            if mutate is not None:
                payload = mutate(db, state['payload'])
                if not isinstance(payload, dict):
                    raise ValueError('Mutation must return a task object')
                revision = state['revision'] + 1
                db.execute('UPDATE operation_tasks SET revision=?,payload=? WHERE owner=? AND session=? AND task=?',
                           (revision, encode(payload), owner, session, current.task_id))
                values = next_receipt.model_dump()
                values['revision'] = revision
                next_receipt = Receipt.model_validate(values)
            encoded = next_receipt.model_dump_json()
            db.execute('UPDATE operations SET receipt=? WHERE owner=? AND session=? AND operation=?',
                       (encoded, owner, session, operation))
            db.execute('INSERT INTO operation_commands VALUES (?,?,?,?,?,?)',
                       (owner, session, operation, command, request, encoded))
            if next_receipt != current:
                self._event(db, owner, session, next_receipt)
            return next_receipt

    def list_operations(self, owner, session, task, *, limit=50):
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid limit')
        with self.connection() as db:
            self._task(db, owner, session, task)
            rows = db.execute('SELECT receipt FROM operations WHERE owner=? AND session=? AND task=? ORDER BY rowid DESC LIMIT ?',
                              (owner, session, task, limit)).fetchall()
            return [Receipt.model_validate_json(row['receipt']) for row in rows]

    def events(self, owner, session, *, after=0, limit=100):
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError('Invalid event cursor or limit')
        with self.connection() as db:
            rows = db.execute('SELECT cursor,receipt FROM operation_events WHERE owner=? AND session=? AND cursor>? ORDER BY cursor LIMIT ?',
                              (owner, session, after, limit)).fetchall()
            # Global DB sequence gives a durable cursor; gaps from other owners are normal.
            return [dict(cursor=row['cursor'], event_id=str(row['cursor']),
                         receipt=json.loads(row['receipt'])) for row in rows]
