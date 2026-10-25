import asyncio
import json

import httpx

from src.apps.companion_runtime.opentalking_session import OpenTalkingSessionClient


def test_bound_session_never_sends_bearer_to_opentalking_and_releases_on_close():
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith('/bind'):
            return httpx.Response(200, json={'context_token': 'opaque', 'expires_at': 123.0})
        if request.url.path == '/sessions':
            assert 'authorization' not in request.headers
            body = json.loads(request.content)
            assert body['session_id'] == 'sess_test'
            assert body['iframe_context_token'] == 'opaque'
            return httpx.Response(200, json={'session_id': 'sess_test', 'status': 'created'})
        if request.url.path.endswith('/release'):
            assert json.loads(request.content) == {'context_token': 'opaque'}
            return httpx.Response(200, json={'session_id': 'sess_test', 'status': 'released'})
        return httpx.Response(200, json={'status': 'closed'})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            api = OpenTalkingSessionClient(client, iframe_base='https://iframe',
                opentalking_base='https://open')
            session = await api.create_bound(
                identity_headers={'Authorization': 'Bearer secret'},
                session_id='sess_test', create_payload={'model': 'mock'})
            assert session.context_token == 'opaque'
            await api.close(session)
    asyncio.run(run())
    assert [request.url.path for request in seen] == [
        '/companion-runtime/opentalking/bind', '/sessions',
        '/sessions/sess_test', '/companion-runtime/opentalking/release']


def test_create_failure_releases_binding():
    paths = []
    def handler(request):
        paths.append(request.url.path)
        if request.url.path.endswith('/bind'):
            return httpx.Response(200, json={'context_token': 'opaque', 'expires_at': 123.0})
        if request.url.path == '/sessions':
            return httpx.Response(502)
        return httpx.Response(200, json={'status': 'released'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            api = OpenTalkingSessionClient(client, iframe_base='https://iframe', opentalking_base='https://open')
            try:
                await api.create_bound(identity_headers={'Authorization': 'Bearer secret'}, session_id='s')
            except RuntimeError:
                pass
    asyncio.run(run())
    assert paths[-1].endswith('/release')
