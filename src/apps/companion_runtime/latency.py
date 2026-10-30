"""Metadata-only monotonic phase timings, scoped to a single chat request."""
from contextvars import ContextVar
from functools import wraps
import json
import logging
import time

_turn = ContextVar('companion_latency_turn', default=None)
logger = logging.getLogger(__name__)


def timed(phase, call):
    @wraps(call)
    def wrapped(*args, **kwargs):
        context = _turn.get()
        started = time.perf_counter()
        status = 'ok'
        try:
            return call(*args, **kwargs)
        except Exception:
            status = 'error'
            raise
        finally:
            if context:
                logger.warning('Companion latency %s', json.dumps({**context, 'phase': phase,
                    'duration_ms': round((time.perf_counter()-started)*1000, 1), 'status': status}))
    return wrapped


def trace_chat(call):
    @wraps(call)
    def wrapped(session_id, body, identity, store):
        token = _turn.set(dict(trace_id=body.trace_id, operation_id=body.operation_id))
        try:
            return timed('chat_total', call)(session_id, body, identity, store)
        finally:
            _turn.reset(token)
    return wrapped


def model_usage(payload):
    """Allowlisted provider counters; never log response text or provider IDs."""
    context = _turn.get()
    if not context or not isinstance(payload, dict):
        return
    usage = payload.get('usage')
    fields = {}
    if isinstance(usage, dict):
        for key in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
            value = usage.get(key)
            if type(value) is int and value >= 0:
                fields[key] = value
    if fields:
        logger.warning('Companion model usage %s', json.dumps({**context, **fields}))
