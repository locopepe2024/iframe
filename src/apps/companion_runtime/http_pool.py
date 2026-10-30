"""Thread-local HTTP pools; credentials stay on each request, never in defaults."""
import atexit
import threading
import requests
from .latency import timed

_local = threading.local()
_sessions = []
_lock = threading.Lock()


def close_pools():
    with _lock:
        sessions, _sessions[:] = list(_sessions), []
    for session in sessions:
        session.close()
    _local.session = None


atexit.register(close_pools)


def post(url, **kwargs):
    session = getattr(_local, 'session', None)
    if session is None:
        session = requests.Session()
        # Do not retry a model generation after an ambiguous network failure.
        session.mount('https://', requests.adapters.HTTPAdapter(max_retries=0))
        _local.session = session
        with _lock:
            _sessions.append(session)
    session.cookies.clear()
    try:
        # HTTP streaming only: model still receives a non-streaming request.
        # Return headers first, then consume the body exactly once before reuse.
        response = timed('cloud_http_headers', session.post)(url, stream=True, **kwargs)
        try:
            timed('cloud_http_body', lambda: response.content)()
            return response
        finally:
            response.close()
    finally:
        session.cookies.clear()
