import asyncio
import json

import httpx
import pytest

from src.apps.companion_runtime.opentalking_context import (
    ContextFragment, ContextUnavailable, IframeContextReader, IframeGatewayReader,
    IframeGroundedLLM, messages_for_turn,
)


def test_read_only_sources_and_identity_isolation():
    requests = []
    def handler(request):
        requests.append(request)
        assert request.headers['authorization'] == 'Bearer session-a'
        body = json.loads(request.content)
        if request.url.path.endswith('/tools'):
            assert body == {'name': 'memory.search', 'arguments': {'query': '散步', 'limit': 4}}
            return httpx.Response(200, json={'memories': [
                {'id': 'm1', 'content': '喜欢散步', 'owner': 'private', 'quote': 'private quote'}]})
        assert body == {'query': '散步', 'limit': 4}
        return httpx.Response(200, json={'hits': [{'unit_id': 'k1', 'title': '公园',
            'excerpt': '一起散步', 'annotation': None, 'source_uri': 'private://secret'}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            reader = IframeContextReader(client, companion_base='https://iframe/demo',
                knowledge_base='https://iframe', identity_headers={'Authorization': 'Bearer session-a'})
            history = [{'role': 'system', 'content': '助手'}, {'role': 'user', 'content': '说说散步'}]
            result = await messages_for_turn(reader, history, query='散步')
            assert len(history) == 2 and len(result) == 3
            assert result[-1] == history[-1]
            assert 'm1' in result[1]['content'] and 'k1' in result[1]['content']
            assert 'private' not in result[1]['content']
    asyncio.run(run())
    assert {str(r.url) for r in requests} == {
        'https://iframe/demo/companion-runtime/tools', 'https://iframe/knowledge/search'}
    assert all(r.method == 'POST' for r in requests)


@pytest.mark.parametrize('status', [401, 403, 503])
def test_retrieval_error_is_not_empty_or_secret_leak(status):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(status, text='private body'))) as client:
            reader = IframeContextReader(client, companion_base='https://iframe',
                knowledge_base='https://iframe', identity_headers={'Authorization': 'Bearer secret'})
            with pytest.raises(ContextUnavailable) as error:
                await reader.search('散步')
            assert 'secret' not in str(error.value) and 'private' not in str(error.value)
    asyncio.run(run())


@pytest.mark.parametrize('payload', [{}, {'memories': 'wrong'}, {'memories': [{'id': 1}]}])
def test_malformed_response_rejected(payload):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json=payload if request.url.path.endswith('/tools') else {'hits': []}))) as client:
            reader = IframeContextReader(client, companion_base='https://iframe',
                knowledge_base='https://iframe', identity_headers={'Authorization': 'Bearer test'})
            with pytest.raises(ContextUnavailable):
                await reader.search('散步')
    asyncio.run(run())


def test_explicit_identity_required():
    with pytest.raises(ValueError, match='identity'):
        IframeContextReader(None, companion_base='https://iframe', knowledge_base='https://iframe',
                            identity_headers={'user_id': 'someone'})


def test_empty_result_and_budget():
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:
            httpx.Response(200, json={'memories': [], 'hits': []}))) as client:
            reader = IframeContextReader(client, companion_base='https://iframe',
                knowledge_base='https://iframe', identity_headers={'Authorization': 'Bearer test'})
            history = [{'role': 'user', 'content': '没有匹配'}]
            assert await messages_for_turn(reader, history, query='没有匹配') == history
            with pytest.raises(ValueError):
                await reader.search('a' * 101)
    asyncio.run(run())


def test_llm_wrapper_single_call_and_unchanged_history():
    class Reader:
        async def search(self, query):
            assert query == '我喜欢什么'
            return (ContextFragment('memory', 'm1', '喜欢散步'),)
    class LLM:
        calls = []
        async def chat_stream(self, messages):
            self.calls.append(messages)
            yield '您喜欢'
            yield '散步。'
    async def run():
        llm = LLM()
        history = [{'role': 'user', 'content': '我喜欢什么'}]
        wrapper = IframeGroundedLLM(llm, Reader())
        assert [chunk async for chunk in wrapper.chat_stream(history)] == ['您喜欢', '散步。']
        assert len(llm.calls) == 1
        assert len(history) == 1
        assert 'm1' in llm.calls[0][0]['content']
        assert llm.calls[0][-1] == history[-1]
    asyncio.run(run())


def test_timeout_does_not_invoke_llm_with_false_empty_context():
    class LLM:
        async def chat_stream(self, messages):
            pytest.fail('LLM must not run after context failure')
            yield ''
    def handler(request):
        raise httpx.ReadTimeout('private failure', request=request)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            reader = IframeContextReader(client, companion_base='https://iframe',
                knowledge_base='https://iframe', identity_headers={'Authorization': 'Bearer test'})
            with pytest.raises(ContextUnavailable):
                _ = [chunk async for chunk in IframeGroundedLLM(LLM(), reader).chat_stream(
                    [{'role': 'user', 'content': '我喜欢什么'}])]
    asyncio.run(run())


def test_gateway_reader_forwards_only_opaque_token_and_bounds_fragments():
    seen = []
    def handler(request):
        seen.append(request)
        assert request.headers['x-opentalking-context-token'] == 'opaque-token'
        return httpx.Response(200, json={'fragments': [
            {'source_type': 'memory', 'source_id': 'm1', 'text': '事实'},
            {'source_type': 'knowledge', 'source_id': 'k1', 'text': '知识'},
        ]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            reader = IframeGatewayReader(client, gateway_url='https://iframe/companion-runtime/opentalking',
                token='opaque-token')
            result = await reader.search('今天', limit=1)
            assert result == (ContextFragment('memory', 'm1', '事实'),
                              ContextFragment('knowledge', 'k1', '知识'))
    asyncio.run(run())
    assert str(seen[0].url) == 'https://iframe/companion-runtime/opentalking/context'
