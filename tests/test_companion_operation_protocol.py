"""Protocol behavior with synthetic receipts; no business tools are executed."""
import pytest
from pydantic import ValidationError
from src.apps.companion_runtime.operation_protocol import (
    Receipt, Wait, advance, resolve_wait, request_cancel,
)


def accepted():
    return Receipt(operation_id='op1', task_id='task1', revision=1)


def test_async_acceptance_is_not_completion_and_terminal_result_is_required():
    first = accepted()
    running = advance(first, 'running')
    assert first.status == 'accepted' and first.event_seq == 1
    assert running.status == 'running' and running.result is None
    with pytest.raises(ValueError):
        advance(running, 'succeeded')
    done = advance(running, 'succeeded', result={'photo_id': 'real-photo'})
    assert done.event_seq == 3 and done.result['photo_id'] == 'real-photo'
    with pytest.raises(ValueError):
        advance(done, 'running')


def test_wait_requires_real_response_and_returns_to_same_operation():
    waiting = advance(advance(accepted(), 'running'), 'waiting_user',
                      wait=Wait(wait_id='w1', card_type='media_source', allowed_events=['photo_selected']))
    resumed = resolve_wait(waiting, wait_id='w1', expected_revision=1,
                           event='photo_selected')
    assert resumed.operation_id == waiting.operation_id
    assert resumed.task_id == waiting.task_id
    assert resumed.status == 'running' and resumed.wait is None
    with pytest.raises(ValueError):
        resolve_wait(resumed, wait_id='w1', expected_revision=1, event='photo_selected')


@pytest.mark.parametrize('patch', [
    {'wait_id': 'old'}, {'expected_revision': 0}, {'event': 'card_displayed'},
])
def test_stale_or_unregistered_wait_response_does_not_resume(patch):
    waiting = advance(accepted(), 'waiting_user', wait=Wait(
        wait_id='w1', card_type='media_source', allowed_events=['photo_selected']))
    values = dict(wait_id='w1', expected_revision=1, event='photo_selected')
    values.update(patch)
    with pytest.raises(ValueError):
        resolve_wait(waiting, **values)
    assert waiting.status == 'waiting_user'


def test_cancel_request_does_not_claim_external_job_cancelled():
    waiting = advance(advance(accepted(), 'running'), 'waiting_external', external_job_id='job1')
    requested = request_cancel(waiting)
    assert requested.status == 'waiting_external' and requested.cancel_requested
    assert request_cancel(requested) == requested
    # External worker owns the race: completion can win against cancellation.
    done = advance(requested, 'succeeded', result={'url': '/result'})
    with pytest.raises(ValueError):
        request_cancel(done)


@pytest.mark.parametrize('values', [
    {'status': 'waiting_user'},
    {'status': 'waiting_external'},
    {'status': 'failed'},
    {'result': {'pretend': 'done'}},
    {'unknown': True},
])
def test_inconsistent_or_unknown_receipt_fields_are_rejected(values):
    with pytest.raises(ValidationError):
        Receipt(operation_id='op1', task_id='task1', revision=1, **values)


def test_sync_result_and_failed_receipt_are_distinct():
    done = advance(accepted(), 'succeeded', result={'count': 0})
    assert done.status == 'succeeded' and done.result == {'count': 0}
    failed = advance(accepted(), 'failed', error={
        'code': 'revision_conflict', 'retryable': False, 'message': 'State changed'})
    assert failed.result is None and not failed.error.retryable
