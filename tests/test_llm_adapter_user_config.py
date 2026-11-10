from types import SimpleNamespace
import sys
import pytest
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.apps.identity import UserContext
from src.apps.studio_access import reset_studio_user, set_studio_user


def test_openai_adapter_uses_request_owner_uniart_config_without_cross_user_cache(monkeypatch):
    calls = []

    class Client:
        def __init__(self, api_key, base_url):
            calls.append((api_key, base_url))
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=api_key))]
            )))

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "stale-shared-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://stale.example/v1")

    configs = {
        "profile-a": {"api_key": "key-a", "base_url": "https://a.example/v1"},
        "profile-b": {"api_key": "key-b", "base_url": "https://b.example/v1"},
    }
    monkeypatch.setattr(
        "src.apps.studio_access.runtime_uniart_for_owner",
        lambda user_id, profile_id: configs[profile_id],
    )
    adapter = LLMAdapter()

    token_a = set_studio_user(UserContext("user-a", "profile-a", "A", ""))
    try:
        assert adapter.chat([{"role": "user", "content": "A"}], model="gpt-5.6-sol") == "key-a"
    finally:
        reset_studio_user(token_a)

    token_b = set_studio_user(UserContext("user-b", "profile-b", "B", ""))
    try:
        assert adapter.chat([{"role": "user", "content": "B"}], model="gpt-5.6-sol") == "key-b"
    finally:
        reset_studio_user(token_b)

    assert calls == [
        ("key-a", "https://a.example/v1"),
        ("key-b", "https://b.example/v1"),
    ]


def test_openai_adapter_keeps_environment_fallback_without_studio_user(monkeypatch):
    captured = {}

    class Client:
        def __init__(self, api_key, base_url):
            captured.update(api_key=api_key, base_url=base_url)

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "desktop-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://desktop.example/v1")

    adapter = LLMAdapter()
    assert adapter._get_client() is adapter._get_client()
    assert captured == {"api_key": "desktop-key", "base_url": "https://desktop.example/v1"}


def test_concurrent_owner_cache_hit_cannot_return_other_owners_client(monkeypatch):
    """Pause A's cache comparison while B replaces the shared cache."""
    entered, release = Event(), Event()
    armed = Event()

    class Key(str):
        __hash__ = str.__hash__

        def strip(self, chars=None):
            return Key(str(self).strip(chars))

        def __eq__(self, other):
            equal = str(self) == str(other)
            if armed.is_set() and equal and str(self) == 'key-a' and not entered.is_set():
                entered.set()
                assert release.wait(3)
            return equal

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=str(api_key)))]
            )))

    monkeypatch.setitem(sys.modules, 'openai', SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setattr('src.apps.studio_access.runtime_uniart_for_owner',
        lambda user_id, profile_id: {'api_key': Key('key-'+profile_id), 'base_url': 'https://example.test/v1'})
    adapter = LLMAdapter()

    def request(owner):
        token = set_studio_user(UserContext(owner, owner, '', ''))
        try:
            return adapter.chat([{'role': 'user', 'content': owner}], model='test-model')
        finally:
            reset_studio_user(token)

    assert request('a') == 'key-a'
    armed.set()
    with ThreadPoolExecutor(max_workers=2) as executor:
        pending_a = executor.submit(request, 'a')
        try:
            assert entered.wait(2)
            assert executor.submit(request, 'b').result(timeout=2) == 'key-b'
        finally:
            release.set()
        assert pending_a.result(timeout=2) == 'key-a'


def test_parallel_owner_calls_send_their_own_authorization(monkeypatch):
    import json
    import httpx
    import openai
    from threading import Barrier

    real_client = openai.OpenAI
    meeting = Barrier(2)

    def receive(request):
        owner = json.loads(request.content)['messages'][0]['content']
        assert request.headers['authorization'] == 'Bearer key-'+owner
        meeting.wait(timeout=3)
        return httpx.Response(200, json={'id': 'test', 'object': 'chat.completion', 'created': 0,
            'model': 'test-model', 'choices': [{'index': 0, 'finish_reason': 'stop',
                'message': {'role': 'assistant', 'content': owner}}]})

    clients = []

    def make_client(**kwargs):
        client = real_client(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(receive)))
        clients.append(client)
        return client

    monkeypatch.setattr(openai, 'OpenAI', make_client)
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_API_KEY', 'shared-key-must-not-be-used')
    monkeypatch.setattr('src.apps.studio_access.runtime_uniart_for_owner',
        lambda user_id, profile_id: {'api_key': 'key-'+profile_id, 'base_url': 'https://example.test/v1'})
    adapter = LLMAdapter()

    def request(owner):
        token = set_studio_user(UserContext(owner, owner, '', ''))
        try:
            return adapter.chat([{'role': 'user', 'content': owner}], model='test-model')
        finally:
            reset_studio_user(token)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            a, b = (executor.submit(request, owner) for owner in ('a', 'b'))
            assert a.result(timeout=5) == 'a'
            assert b.result(timeout=5) == 'b'
    finally:
        for client in clients:
            client.close()


def test_chat_forwards_per_request_timeout_and_retry_options(monkeypatch):
    captured = {}

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
            )))

        def with_options(self, **options):
            captured.update(options)
            return self

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")

    adapter = LLMAdapter()
    assert adapter.chat(
        [{"role": "user", "content": "director"}],
        timeout_seconds=300,
        max_retries=0,
    ) == "ok"
    assert captured == {"timeout": 300, "max_retries": 0}


def test_explicit_model_retries_transient_gateway_502_once(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=lambda **kwargs: object()))
    adapter = LLMAdapter()
    attempts = []

    def fake_once(*args, **kwargs):
        attempts.append(kwargs.get("max_retries"))
        if len(attempts) == 1:
            raise RuntimeError("OpenAI API error status=502: Error code: 502")
        return "ok"

    monkeypatch.setattr(adapter, "_chat_once", fake_once)
    monkeypatch.setattr("src.apps.comic_gen.llm_adapter.time.sleep", lambda _: None)
    assert adapter.chat([{"role": "user", "content": "director"}], model="qwen3.8-flash") == "ok"
    assert attempts == [None, 0]


def test_chat_assembles_streamed_json_and_closes_response(monkeypatch):
    captured = {}

    class Stream:
        closed = False

        def __iter__(self):
            for content in ('{"setting":', None, '{"time":"day"}}'):
                yield SimpleNamespace(choices=[SimpleNamespace(
                    delta=SimpleNamespace(content=content)
                )])

        def close(self):
            self.closed = True

    response = Stream()

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            captured.update(kwargs)
            return response

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")

    adapter = LLMAdapter()
    assert adapter.chat(
        [{"role": "user", "content": "director"}],
        response_format={"type": "json_object"},
        stream=True,
    ) == '{"setting":{"time":"day"}}'
    assert captured["stream"] is True
    assert captured["response_format"] == {"type": "json_object"}
    assert response.closed


def test_script_processor_uses_shared_screenplay_model(monkeypatch):
    from src.apps.comic_gen.llm_adapter import get_script_writing_model

    monkeypatch.setenv("SCRIPT_WRITING_MODEL", "nsfw/llm-nf-all")
    monkeypatch.setenv("SCRIPT_CONTINUATION_MODEL", "nsfw/other-model")
    assert get_script_writing_model() == "nsfw/llm-nf-all"

    monkeypatch.delenv("SCRIPT_WRITING_MODEL")
    assert get_script_writing_model() == "nsfw/other-model"


def test_adapter_default_model_is_used_when_call_has_no_override(monkeypatch):
    adapter = LLMAdapter(default_model="nsfw/llm-nf-all")
    captured = {}
    monkeypatch.setattr(adapter, "_get_client", lambda **_: object())
    monkeypatch.setattr(adapter, "_chat_once", lambda _client, model, *_args, **_kwargs: captured.setdefault("model", model))

    assert adapter.chat([{"role": "user", "content": "director analysis"}]) == "llm-nf-all"
    assert captured["model"] == "llm-nf-all"


def test_script_adapter_uses_request_snapshot_without_changing_other_adapters(monkeypatch):
    from contextvars import copy_context
    from src.apps.studio_access import set_studio_script_model, reset_studio_script_model
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_MODEL', 'generic-default')
    screenplay = LLMAdapter(default_model='greena/llm-nf-all', use_script_model=True)
    generic = LLMAdapter(default_model='generic-model')
    for adapter in [screenplay, generic]:
        monkeypatch.setattr(adapter, '_get_client', lambda **_: object())
        monkeypatch.setattr(adapter, '_chat_once', lambda _client, model, *_args, **_kwargs: model)
    token = set_studio_script_model('greena/deepseek-v4.1-flash')
    try:
        frozen = copy_context()
        assert screenplay.chat([]) == 'deepseek-v4.1-flash'
        assert screenplay.chat([], model='explicit-polish') == 'explicit-polish'
        assert generic.chat([]) == 'generic-model'
    finally:
        reset_studio_script_model(token)
    assert screenplay.chat([]) == 'llm-nf-all'
    assert frozen.run(screenplay.chat, []) == 'deepseek-v4.1-flash'
    assert screenplay.default_model == 'greena/llm-nf-all'


@pytest.mark.parametrize('text', ['{"setting":', '{"setting":{}}'])
def test_real_sdk_stream_error_stays_failed_and_records_boundary(text, caplog):
    import httpx
    from openai import OpenAI
    import json

    class Wire(httpx.SyncByteStream):
        closed = False
        def __iter__(self):
            yield ('data: ' + json.dumps({'id': 'test', 'object': 'chat.completion.chunk',
                'created': 0, 'model': 'test-model', 'choices': [{'index': 0,
                'delta': {'content': text}, 'finish_reason': None}]}) + '\n\n').encode()
            yield b'data: {"error":{"type":"api_error","message":"Upstream returned an error event (request_id: event-id)"}}\n\n'
            yield b'data: [DONE]\n\n'
        def close(self):self.closed = True
    wire = Wire()
    sent = {}
    def receive(request):
        sent.update(json.loads(request.content))
        return httpx.Response(200,headers={'Content-Type':'text/event-stream','x-request-id':'gateway-id'},stream=wire)
    with OpenAI(api_key='test',base_url='https://example.test/v1',
                http_client=httpx.Client(transport=httpx.MockTransport(receive))) as client:
        adapter = LLMAdapter()
        with pytest.raises(RuntimeError, match='Upstream returned an error event') as caught:
            adapter._chat_once(client,'test-model',[{'role':'user','content':'PRIVATE_SCREENPLAY'}],
                {'type':'json_object'},stream=True,timeout_seconds=900,max_retries=0)
    diagnostic = caught.value.llm_diagnostic
    assert diagnostic['request_id'] == 'gateway-id'
    assert diagnostic['text_chars'] == len(text)
    assert diagnostic['chunks_received'] == 1
    assert diagnostic['finish_reason'] is None
    assert diagnostic['elapsed_seconds'] >= 0
    assert wire.closed
    assert sent['stream'] is True
    assert 'max_tokens' not in sent and 'max_completion_tokens' not in sent
    assert 'PRIVATE_SCREENPLAY' not in caplog.text
    assert 'failed before close' in caplog.text
