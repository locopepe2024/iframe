import asyncio

import httpx
import pytest

from src.apps.companion_runtime.opentalking_binding import SessionBindings, BindingUnavailable


def bind(registry, sid='s', owner='owner', actor='actor'):
    registry.bind(sid, owner=owner, actor=actor,
        identity_headers={'Authorization': 'Bearer test'}, expires_at=110)


def test_scope_expiry_rebind_and_logout():
    now = [100]
    registry = SessionBindings(clock=lambda: now[0])
    bind(registry)
    with pytest.raises(BindingUnavailable):
        registry.release('s', owner='other', actor='actor')
    with pytest.raises(BindingUnavailable):
        bind(registry)
    bind(registry, 's2')
    registry.revoke_owner('owner')
    assert not registry._bindings
    bind(registry)
    now[0] = 111
    with pytest.raises(BindingUnavailable):
        registry.release('s', owner='owner', actor='actor')
    assert not registry._bindings


def test_each_turn_checks_identity_and_release_stops_stream():
    registry = SessionBindings(clock=lambda: 100)
    bind(registry)
    seen = []
    def handler(request):
        seen.append(request.url.path)
        assert request.headers['authorization'] == 'Bearer test'
        if request.url.path == '/auth/me':
            return httpx.Response(200, json={'profile': {'profile_id': 'owner'}, 'user': {'user_id': 'actor'}})
        return httpx.Response(200, json={'memories': [], 'hits': []})
    class LLM:
        async def chat_stream(self, messages):
            yield '第一段'
            yield '第二段'
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            wrapper = await registry.grounded_llm('s', owner='owner', actor='actor', client=client,
                companion_base='https://iframe', knowledge_base='https://iframe',
                identity_base='https://iframe', upstream=LLM())
            messages = [{'role': 'user', 'content': '你好呀'}]
            assert [part async for part in wrapper.chat_stream(messages)] == ['第一段', '第二段']
            stream = wrapper.chat_stream(messages)
            assert await anext(stream) == '第一段'
            registry.release('s', owner='owner', actor='actor')
            with pytest.raises(BindingUnavailable):
                await anext(stream)
    asyncio.run(run())
    assert seen.count('/auth/me') == 2


@pytest.mark.parametrize('failure', ['wrong_owner', 'unauthorized', 'timeout'])
def test_identity_failure_never_retrieves_private_data(failure):
    registry = SessionBindings(clock=lambda: 100)
    bind(registry)
    seen = []
    def handler(request):
        seen.append(request.url.path)
        if failure == 'timeout':
            raise httpx.ReadTimeout('secret', request=request)
        if failure == 'unauthorized':
            return httpx.Response(401)
        return httpx.Response(200, json={'profile': {'profile_id': 'other'}, 'user': {'user_id': 'actor'}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            wrapper = await registry.grounded_llm('s', owner='owner', actor='actor', client=client,
                companion_base='https://iframe', knowledge_base='https://iframe',
                identity_base='https://iframe', upstream=None)
            with pytest.raises(BindingUnavailable):
                _ = [part async for part in wrapper.chat_stream([{'role': 'user', 'content': '记忆'}])]
    asyncio.run(run())
    assert seen == ['/auth/me']


def test_no_fingerprint_or_anonymous_binding():
    registry = SessionBindings(clock=lambda: 100)
    with pytest.raises(ValueError):
        registry.bind('s', owner='owner', actor='actor', identity_headers={
            'X-iFrame-API-Key-Identity': 'f' * 64}, expires_at=110)


def test_revocation_during_retrieval_blocks_llm_call():
    registry = SessionBindings(clock=lambda: 100)
    bind(registry)
    def handler(request):
        if request.url.path == '/auth/me':
            return httpx.Response(200, json={'profile': {'profile_id': 'owner'},
                                            'user': {'user_id': 'actor'}})
        registry.revoke_owner('owner')
        return httpx.Response(200, json={'memories': [], 'hits': []})
    class LLM:
        async def chat_stream(self, messages):
            pytest.fail('revoked context must not reach LLM')
            yield ''
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            wrapper = await registry.grounded_llm('s', owner='owner', actor='actor', client=client,
                companion_base='https://iframe', knowledge_base='https://iframe',
                identity_base='https://iframe', upstream=LLM())
            with pytest.raises(BindingUnavailable):
                _ = [part async for part in wrapper.chat_stream([{'role': 'user', 'content': '记忆'}])]
    asyncio.run(run())


def test_bound_stream_reads_real_memory_api_without_cross_user_data(tmp_path):
    from fastapi import FastAPI, Request, Depends
    from src.apps.companion_runtime.api import router, get_store
    from src.apps.companion_runtime.chat_store import ChatStore
    from src.apps.identity import UserContext, require_user_context

    store = ChatStore(tmp_path / 'memory.db', initialize=True)
    for owner, fact in [('alice', '喜欢散步'), ('bob', '喜欢游泳')]:
        session = store.session(owner, 'session')['session_id']
        source = store.message(owner, session, 'message', fact)
        preview = store.prepare(owner, owner, 'save', {'source_message_id': source['id'],
            'quote': fact, 'content': fact, 'type': 'preference', 'importance': 3})
        store.confirm(owner, owner, preview['preview_token'], 'save')
    app = FastAPI()
    app.include_router(router)
    def identity(request: Request):
        owner = request.headers['authorization'].removeprefix('Bearer ')
        return UserContext(owner, owner, '', '')
    app.dependency_overrides[require_user_context] = identity
    app.dependency_overrides[get_store] = lambda: store
    @app.get('/auth/me')
    def me(ctx=Depends(require_user_context)):
        return {'profile': {'profile_id': ctx.owner_profile_id}, 'user': {'user_id': ctx.user_id}}
    # Knowledge SQL visibility has separate PostgreSQL tests. Here only memory
    # runs against its real store; knowledge has an explicitly empty fixture.
    @app.post('/knowledge/search')
    def knowledge(ctx=Depends(require_user_context)):
        return {'hits': []}
    class LLM:
        async def chat_stream(self, messages):
            yield messages[0]['content']
    async def run():
        registry = SessionBindings(clock=lambda: 100)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
            for owner, expected, excluded in [('alice', '喜欢散步', '喜欢游泳'),
                                               ('bob', '喜欢游泳', '喜欢散步')]:
                registry.bind(owner, owner=owner, actor=owner,
                    identity_headers={'Authorization': 'Bearer ' + owner}, expires_at=110)
                llm = await registry.grounded_llm(owner, owner=owner, actor=owner,
                    client=client, companion_base='http://test', knowledge_base='http://test',
                    identity_base='http://test', upstream=LLM())
                output = ''.join([part async for part in llm.chat_stream(
                    [{'role': 'user', 'content': '喜欢'}])])
                assert expected in output and excluded not in output
    asyncio.run(run())
