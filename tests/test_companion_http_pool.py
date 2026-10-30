from unittest.mock import Mock
import pytest
from src.apps.companion_runtime import http_pool


def test_reuses_connections_without_retaining_credentials_or_cookies(monkeypatch):
    http_pool.close_pools()
    session = Mock()
    factory = Mock(return_value=session)
    monkeypatch.setattr(http_pool.requests, 'Session', factory)
    http_pool.post('https://example.test/v1/chat', headers={'Authorization': 'Bearer first'})
    http_pool.post('https://example.test/v1/chat', headers={'Authorization': 'Bearer second'})
    assert factory.call_count == 1
    assert [c.kwargs['headers']['Authorization'] for c in session.post.call_args_list] == ['Bearer first', 'Bearer second']
    assert session.cookies.clear.call_count == 4
    assert session.mount.call_args.args[1].max_retries.total == 0
    session.post.side_effect = RuntimeError('uncertain')
    with pytest.raises(RuntimeError):
        http_pool.post('https://example.test/v1/chat')
    assert session.post.call_count == 3
    assert session.cookies.clear.call_count == 6
    http_pool.close_pools()
    session.close.assert_called_once()
