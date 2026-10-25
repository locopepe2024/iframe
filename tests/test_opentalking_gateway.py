import asyncio

import httpx
import pytest
from fastapi import FastAPI

from src.apps.companion_runtime import api
from src.apps.companion_runtime.opentalking_binding import SessionBindings
from src.apps.companion_runtime.opentalking_context import ContextFragment
from src.apps.identity import UserContext, require_user_context


def make_app(monkeypatch, identity):
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[require_user_context] = lambda: identity
    monkeypatch.setattr(api, '_opentalking_bindings', SessionBindings())
    return app


def test_bind_requires_verified_bearer(monkeypatch):
    app = make_app(monkeypatch, UserContext('browser-x', 'browser-x', 'Demo', ''))

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/companion-runtime/opentalking/bind',
                json={'session_id': 's'})
            assert response.status_code == 401
            assert 'verified login' in response.json()['detail']
    asyncio.run(run())


def test_bind_issues_opaque_token_and_context_uses_bound_identity(monkeypatch):
    identity = UserContext('alice', 'profile-alice', 'Alice', 'real-bearer')
    app = make_app(monkeypatch, identity)
    monkeypatch.setenv('IFRAME_OPENTALKING_COMPANION_BASE', 'http://iframe')
    monkeypatch.setenv('IFRAME_OPENTALKING_KNOWLEDGE_BASE', 'http://iframe')

    class Reader:
        def __init__(self, client, *, companion_base, knowledge_base, identity_headers):
            assert identity_headers == {'Authorization': 'Bearer real-bearer'}
            self.identity_headers = identity_headers

        async def search(self, query, *, limit):
            assert query == '女儿'
            return (ContextFragment('memory', 'm1', '女儿来看我'),)

    monkeypatch.setattr(api, 'IframeContextReader', Reader)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            bound = await client.post('/companion-runtime/opentalking/bind',
                json={'session_id': 's', 'ttl_seconds': 120})
            assert bound.status_code == 200
            payload = bound.json()
            token = payload['context_token']
            assert isinstance(token, str) and len(token) >= 30
            assert 'alice' not in token and 'real-bearer' not in token
            context = await client.post('/companion-runtime/opentalking/context',
                headers={'X-OpenTalking-Context-Token': token},
                json={'query': '女儿'})
            assert context.status_code == 200
            assert context.json() == {'fragments': [
                {'source_type': 'memory', 'source_id': 'm1', 'text': '女儿来看我'}]}
    asyncio.run(run())


def test_context_token_expires_and_release_revokes(monkeypatch):
    app = make_app(monkeypatch, UserContext('alice', 'profile-alice', 'Alice', 'bearer'))

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/companion-runtime/opentalking/context',
                headers={'X-OpenTalking-Context-Token': 'missing'},
                json={'query': '记忆'})
            assert response.status_code == 401
            bound = await client.post('/companion-runtime/opentalking/bind',
                json={'session_id': 's', 'ttl_seconds': 60})
            token = bound.json()['context_token']
            api._opentalking_bindings.release('s', owner='profile-alice', actor='alice')
            revoked = await client.post('/companion-runtime/opentalking/context',
                headers={'X-OpenTalking-Context-Token': token}, json={'query': '记忆'})
            assert revoked.status_code == 401


def test_release_endpoint_revokes_token_without_bearer(monkeypatch):
    app = make_app(monkeypatch, UserContext('alice', 'profile-alice', 'Alice', 'bearer'))

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            bound = await client.post('/companion-runtime/opentalking/bind',
                json={'session_id': 's', 'ttl_seconds': 60})
            token = bound.json()['context_token']
            released = await client.post('/companion-runtime/opentalking/release',
                json={'context_token': token})
            assert released.status_code == 200
            assert released.json() == {'session_id': 's', 'status': 'released'}
            again = await client.post('/companion-runtime/opentalking/release',
                json={'context_token': token})
            assert again.status_code == 401
    asyncio.run(run())
    asyncio.run(run())


def test_gateway_not_configured_is_explicit_503(monkeypatch):
    app = make_app(monkeypatch, UserContext('alice', 'profile-alice', 'Alice', 'bearer'))
    monkeypatch.delenv('IFRAME_OPENTALKING_COMPANION_BASE', raising=False)
    monkeypatch.delenv('IFRAME_OPENTALKING_KNOWLEDGE_BASE', raising=False)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            bound = await client.post('/companion-runtime/opentalking/bind',
                json={'session_id': 's', 'ttl_seconds': 60})
            response = await client.post('/companion-runtime/opentalking/context',
                headers={'X-OpenTalking-Context-Token': bound.json()['context_token']},
                json={'query': '记忆'})
            assert response.status_code == 503
            assert 'not configured' in response.json()['detail']
    asyncio.run(run())
