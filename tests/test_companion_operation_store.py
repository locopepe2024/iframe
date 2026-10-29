"""Durable protocol tests use fake local mutations, never production tools."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from src.apps.companion_runtime.operation_store import OperationStore, Conflict, Missing


def setup_store(tmp_path):
    path = tmp_path / 'operations.db'
    store = OperationStore(path, initialize=True)
    store.create_task('alice', 'chat1', 'task1', {'brief': '人物不变'})
    return store, path


def accept(store, op='op1', owner='alice', session='chat1', task='task1', revision=1):
    return store.accept(owner, session, op, task, revision, 'fake.edit', {'source': 'album'})


def test_same_request_returns_original_receipt_after_reopen(tmp_path):
    store, path = setup_store(tmp_path)
    first = accept(store)
    assert accept(OperationStore(path)) == first
    with pytest.raises(Conflict):
        store.accept('alice', 'chat1', 'op1', 'task1', 1, 'fake.edit', {'source': 'upload'})
    assert len(store.events('alice', 'chat1')) == 1


def test_atomic_mutation_receipt_and_event_survive_reopen(tmp_path):
    store, path = setup_store(tmp_path)
    accept(store)
    def mutate(db, payload):
        payload['brief'] += '，背景海边'
        return payload
    done = store.change('alice', 'chat1', 'op1', 'complete1', 1, 1,
                        'succeeded', result={'saved': True}, business_input={'append': '，背景海边'}, mutate=mutate)
    reopened = OperationStore(path)
    assert reopened.get('alice', 'chat1', 'op1') == done
    assert reopened.task('alice', 'chat1', 'task1')['payload']['brief'] == '人物不变，背景海边'
    assert done.revision == 2
    assert reopened.events('alice', 'chat1', after=1)[0]['receipt'] == done.model_dump()
    def must_not_run(db, payload):
        raise AssertionError('retry executed mutation')
    assert reopened.change('alice', 'chat1', 'op1', 'complete1', 1, 1,
                            'succeeded', result={'saved': True}, business_input={'append': '，背景海边'}, mutate=must_not_run) == done


def test_mid_transaction_failure_rolls_back_business_receipt_and_event(tmp_path):
    store, path = setup_store(tmp_path)
    accept(store)
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE fake_writes (value TEXT)')
    def fail(db, payload):
        db.execute("INSERT INTO fake_writes VALUES ('should roll back')")
        raise RuntimeError('worker crashed')
    with pytest.raises(RuntimeError):
        store.change('alice', 'chat1', 'op1', 'complete1', 1, 1,
                     'succeeded', result={}, business_input={'fake': 'write'}, mutate=fail)
    assert store.get('alice', 'chat1', 'op1').status == 'accepted'
    assert store.task('alice', 'chat1', 'task1')['revision'] == 1
    assert len(store.events('alice', 'chat1')) == 1
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM fake_writes').fetchone()[0] == 0


def waiting(store):
    accept(store)
    return store.change('alice', 'chat1', 'op1', 'wait1', 1, 1, 'waiting_user', wait={
        'wait_id': 'w1', 'card_type': 'media_source', 'allowed_events': ['photo_selected']})


def test_wait_response_consumed_once_even_with_competing_commands(tmp_path):
    store, path = setup_store(tmp_path)
    waiting(store)
    def run(command):
        try:
            return OperationStore(path).change('alice', 'chat1', 'op1', command, 2, 1,
                'running', wait_response={'wait_id': 'w1', 'event': 'photo_selected'},
                business_input={'photo_id': 'photo1'},
                mutate=lambda db, payload: {**payload, 'photo_id': 'photo1'})
        except Conflict:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, ['select1', 'select2']))
    assert sum(result is not None for result in results) == 1
    assert store.task('alice', 'chat1', 'task1')['revision'] == 2
    assert len(store.events('alice', 'chat1')) == 3


@pytest.mark.parametrize('response', [
    {'wait_id': 'old', 'event': 'photo_selected'},
    {'wait_id': 'w1', 'event': 'card_displayed'},
    None,
])
def test_invalid_wait_cannot_advance(tmp_path, response):
    store, _ = setup_store(tmp_path)
    waiting(store)
    with pytest.raises(ValueError):
        store.change('alice', 'chat1', 'op1', 'select1', 2, 1, 'running', wait_response=response)
    assert store.get('alice', 'chat1', 'op1').status == 'waiting_user'


def test_concurrent_task_change_rejects_stale_operation(tmp_path):
    store, _ = setup_store(tmp_path)
    accept(store, 'op1')
    accept(store, 'op2')
    store.change('alice', 'chat1', 'op2', 'save2', 1, 1, 'succeeded', result={}, business_input={'brief': '新要求'},
                 mutate=lambda db, payload: {**payload, 'brief': '新要求'})
    with pytest.raises(Conflict):
        store.change('alice', 'chat1', 'op1', 'save1', 1, 1, 'succeeded', result={})
    assert store.get('alice', 'chat1', 'op1').status == 'accepted'


def test_owner_and_session_scoping_and_event_replay(tmp_path):
    store, _ = setup_store(tmp_path)
    accept(store)
    for owner, session in [('bob', 'chat1'), ('alice', 'other')]:
        with pytest.raises(Missing):
            store.get(owner, session, 'op1')
        with pytest.raises(Missing):
            store.task(owner, session, 'task1')
        assert store.events(owner, session) == []
    assert [r.operation_id for r in store.list_operations('alice', 'chat1', 'task1')] == ['op1']
    event = store.events('alice', 'chat1')[0]
    assert store.events('alice', 'chat1', after=event['cursor']) == []


def test_reused_command_with_changed_payload_is_rejected(tmp_path):
    store, _ = setup_store(tmp_path)
    accept(store)
    store.change('alice', 'chat1', 'op1', 'done1', 1, 1, 'succeeded', result={'value': 1})
    with pytest.raises(Conflict):
        store.change('alice', 'chat1', 'op1', 'done1', 1, 1, 'succeeded', result={'value': 2})


def test_cancel_request_persists_without_claiming_cancelled(tmp_path):
    store, path = setup_store(tmp_path)
    accept(store)
    requested = store.change('alice', 'chat1', 'op1', 'cancel1', 1, 1, 'cancel_request')
    assert requested.status == 'accepted' and requested.cancel_requested
    assert OperationStore(path).get('alice', 'chat1', 'op1') == requested
    done = store.change('alice', 'chat1', 'op1', 'worker_done', 2, 1, 'succeeded', result={})
    assert done.status == 'succeeded'



def test_concurrent_acceptance_has_one_operation_and_event(tmp_path):
    store, path = setup_store(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: accept(OperationStore(path)), range(2)))
    assert results[0] == results[1]
    assert len(store.list_operations('alice', 'chat1', 'task1')) == 1
    assert len(store.events('alice', 'chat1')) == 1


def test_old_command_retry_returns_original_receipt_without_rewinding_state(tmp_path):
    store, _ = setup_store(tmp_path)
    first = waiting(store)
    resumed = store.change('alice', 'chat1', 'op1', 'select1', 2, 1, 'running',
                           wait_response={'wait_id': 'w1', 'event': 'photo_selected'})
    replay = store.change('alice', 'chat1', 'op1', 'wait1', 1, 1, 'waiting_user', wait={
        'wait_id': 'w1', 'card_type': 'media_source', 'allowed_events': ['photo_selected']})
    assert replay == first
    assert store.get('alice', 'chat1', 'op1') == resumed
    assert len(store.events('alice', 'chat1')) == 3


def test_event_append_failure_rolls_back_task_mutation(tmp_path, monkeypatch):
    store, _ = setup_store(tmp_path)
    accept(store)
    def broken_append(*args):
        raise RuntimeError('event storage failed')
    monkeypatch.setattr(store, '_event', broken_append)
    with pytest.raises(RuntimeError):
        store.change('alice', 'chat1', 'op1', 'done', 1, 1, 'succeeded', result={},
                     business_input={'brief': 'new'},
                     mutate=lambda db, payload: {**payload, 'brief': 'new'})
    assert store.task('alice', 'chat1', 'task1')['revision'] == 1
    assert store.get('alice', 'chat1', 'op1').status == 'accepted'
    assert len(store.events('alice', 'chat1')) == 1


def test_mutation_requires_deduplicatable_semantic_input(tmp_path):
    store, _ = setup_store(tmp_path)
    accept(store)
    with pytest.raises(ValueError, match='semantic inputs'):
        store.change('alice', 'chat1', 'op1', 'done', 1, 1, 'succeeded', result={},
                     mutate=lambda db, payload: payload)
