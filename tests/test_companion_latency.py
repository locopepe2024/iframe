import logging
from types import SimpleNamespace
import pytest
from src.apps.companion_runtime.latency import timed, trace_chat


def test_latency_links_phases_and_resets_context(caplog):
    @trace_chat
    def chat(session_id, body, identity, store):
        return timed('cloud_qwen', lambda: 'reply')()
    caplog.set_level(logging.WARNING)
    assert chat('s', SimpleNamespace(trace_id='trace-1', operation_id='op-1'), None, None) == 'reply'
    assert 'cloud_qwen' in caplog.text and 'chat_total' in caplog.text
    assert 'trace-1' in caplog.text and 'op-1' in caplog.text
    caplog.clear()
    timed('outside', lambda: None)()
    assert not caplog.text


def test_latency_preserves_failure_without_logging_content(caplog):
    @trace_chat
    def chat(session_id, body, identity, store):
        raise ValueError('private sentence')
    with pytest.raises(ValueError):
        chat('s', SimpleNamespace(trace_id='t', operation_id='o'), None, None)
    assert 'error' in caplog.text and 'private sentence' not in caplog.text
