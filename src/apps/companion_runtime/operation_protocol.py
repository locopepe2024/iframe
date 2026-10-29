"""Pure operation protocol. No persistence, tools, authentication or transport.

Callers must serialize writes and persist the receipt atomically with business
changes. These functions validate transitions, not permissions or side effects.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Status = Literal['accepted', 'running', 'waiting_user', 'waiting_external',
                 'succeeded', 'failed', 'cancelled']
TERMINAL = {'succeeded', 'failed', 'cancelled'}
TRANSITIONS = {
    'accepted': {'running', 'waiting_user', 'succeeded', 'failed', 'cancelled'},
    'running': {'waiting_user', 'waiting_external', 'succeeded', 'failed', 'cancelled'},
    'waiting_user': {'running', 'failed', 'cancelled'},
    'waiting_external': {'running', 'succeeded', 'failed', 'cancelled'},
}


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)


class Error(Strict):
    code: str = Field(min_length=1, max_length=100)
    retryable: bool
    message: str = Field(min_length=1, max_length=500)


class Wait(Strict):
    wait_id: str = Field(min_length=1, max_length=120)
    card_type: str = Field(min_length=1, max_length=100)
    allowed_events: list[str] = Field(min_length=1, max_length=10)

    @model_validator(mode='after')
    def unique_events(self):
        if any(not event.strip() for event in self.allowed_events):
            raise ValueError('Empty event name')
        if len(set(self.allowed_events)) != len(self.allowed_events):
            raise ValueError('Duplicate event names')
        return self


class Receipt(Strict):
    operation_id: str = Field(min_length=1, max_length=120)
    task_id: str | None = Field(default=None, min_length=1, max_length=120)
    revision: int = Field(ge=1)
    event_seq: int = Field(default=1, ge=1)
    status: Status = 'accepted'
    result: dict | None = None
    error: Error | None = None
    wait: Wait | None = None
    external_job_id: str | None = Field(default=None, min_length=1, max_length=200)
    cancel_requested: bool = False

    @model_validator(mode='after')
    def consistent(self):
        if (self.status == 'waiting_user') != (self.wait is not None):
            raise ValueError('User wait requires a wait descriptor, only while waiting')
        if (self.status == 'succeeded') != (self.result is not None):
            raise ValueError('Only successful operations carry a result')
        if (self.status == 'failed') != (self.error is not None):
            raise ValueError('Only failed operations carry an error')
        if self.status == 'waiting_external' and not self.external_job_id:
            raise ValueError('External wait requires a queryable job reference')
        return self


def advance(receipt: Receipt, status: Status, *, result=None, error=None,
            wait=None, external_job_id=None, revision=None) -> Receipt:
    """Create a validated receipt; input and operation identity stay unchanged.

    event_seq is operation-local, not a task/global stream cursor. A durable
    repository must allocate a separate stream sequence for cross-operation sync.
    Result schemas, registered card types and real asset IDs are caller checks.
    """
    if status not in TRANSITIONS.get(receipt.status, set()):
        raise ValueError(f'Illegal transition: {receipt.status} -> {status}')
    if revision is not None and revision < receipt.revision:
        raise ValueError('Revision cannot move backwards')
    values = receipt.model_dump()
    values.update(status=status, result=result, error=error, wait=wait,
                  event_seq=receipt.event_seq + 1,
                  revision=receipt.revision if revision is None else revision)
    if external_job_id is not None:
        values['external_job_id'] = external_job_id
    return Receipt.model_validate(values)


def resolve_wait(receipt: Receipt, *, wait_id: str, expected_revision: int,
                 event: str) -> Receipt:
    """Validate wait identity and event before resuming; does not bind assets.

    The repository must atomically consume the wait and deduplicate the response.
    Event payload validation and authorization are required before calling this.
    """
    if receipt.status != 'waiting_user' or receipt.wait is None:
        raise ValueError('Operation is not waiting for a user')
    if receipt.wait.wait_id != wait_id or receipt.revision != expected_revision:
        raise ValueError('Stale wait response')
    if event not in receipt.wait.allowed_events:
        raise ValueError('Event cannot satisfy this wait')
    return advance(receipt, 'running')


def request_cancel(receipt: Receipt) -> Receipt:
    """Record intent only. Executor acknowledgement determines terminal state."""
    if receipt.status in TERMINAL:
        raise ValueError('Operation has already finished')
    if receipt.cancel_requested:
        return receipt
    values = receipt.model_dump()
    values.update(cancel_requested=True, event_seq=receipt.event_seq + 1)
    return Receipt.model_validate(values)
