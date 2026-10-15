import io
import json
from unittest.mock import Mock

import httpx
import pytest
from fastapi import HTTPException
from openai import APIStatusError
from pydantic import ValidationError

from src.apps import agent_api as agent
from src.apps.identity import UserContext
from src.apps.user_config import UserConfigStore, UserConfigUpdate
from src.utils import provider_catalog


@pytest.mark.parametrize('name,label', [('uniart', 'UniArt Catalog'), ('greena', 'GreenA Catalog')])
def test_catalog_name_is_saved_with_gateway_and_survives_key_preserving_save(tmp_path, name, label):
    identity = UserContext('u', 'p', 'name', 'token')
    store = UserConfigStore(str(tmp_path / 'users.db'))
    saved = store.update(identity, UserConfigUpdate(catalog_name=name, UNIART_API_KEY='test-key-' * 4, UNIART_BASE_URL='https://gateway.example/v1'))
    assert saved['catalog_name'] == name
    store.update(identity, UserConfigUpdate(preferences={'theme': 'dark'}))
    runtime = store.get_runtime_uniart(identity)
    assert runtime['catalog_name'] == name
    assert runtime['api_key'] == 'test-key-' * 4
    assert runtime['base_url'] == 'https://gateway.example/v1'
    assert provider_catalog.catalog_label(runtime) == label
    assert 'test-key-' * 4 not in json.dumps(saved)
    other = UserContext('other', 'other', 'other', 'token')
    assert store.get_public(other).get('catalog_name') is None


def test_unnamed_legacy_gateway_is_neutral_not_inferred_from_url_or_model():
    assert provider_catalog.catalog_label({'base_url': 'https://uniart.example/v1'}) == '当前 Catalog'
    assert provider_catalog.catalog_label({'provider': 'nsfw'}) == 'GreenA Catalog'
    assert provider_catalog.catalog_label({'provider': 'uniart', 'catalog_name': 'greena'}) == 'UniArt Catalog'
    with pytest.raises(ValidationError):
        UserConfigUpdate(catalog_name='untrusted')


@pytest.mark.parametrize('name,prefix', [('uniart', 'uniart'), ('greena', 'nsfw')])
def test_selected_catalog_uses_matching_gateway_key_namespace_and_label(monkeypatch, name, prefix):
    observed = {}
    def reply(request, timeout):
        observed['url'] = request.full_url
        observed['auth'] = request.get_header('Authorization')
        return io.BytesIO(json.dumps({'data': [{'id': 'llm-nf-all'}]}).encode())
    monkeypatch.setattr(provider_catalog, 'urlopen', reply)
    config = {'base_url': 'https://gateway.example/v1', 'api_key': 'test-key', 'catalog_name': name}
    models = provider_catalog.fetch_selected_catalog(config)
    assert observed == {'url': 'https://gateway.example/v1/models', 'auth': 'Bearer test-key'}
    assert models[0]['id'] == f'{prefix}/llm-nf-all'
    assert models[0]['provider'] == name


@pytest.mark.parametrize('name,label', [('uniart', 'UniArt Catalog'), ('greena', 'GreenA Catalog'), (None, '当前 Catalog')])
def test_agent_transport_error_uses_dispatch_catalog_and_releases_request_context(tmp_path, monkeypatch, name, label):
    ctx = UserContext('u', 'p', 'name', 'token')
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.db'))
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'llm-nf-all'}])
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value={
        'base_url': 'https://gateway.example/v1', 'api_key': 'test', 'catalog_name': name})))
    response = httpx.Response(500, request=httpx.Request('POST', 'https://gateway.example/v1/chat/completions'))
    error = APIStatusError('private-upstream-detail', response=response, body=None)
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    client.chat.completions.create.side_effect = error
    import openai
    monkeypatch.setattr(openai, 'OpenAI', Mock(return_value=client))
    sid = agent.create(agent.SessionCreate(model='llm-nf-all'), ctx)['session']['id']
    with pytest.raises(HTTPException) as caught:
        agent.send(sid, agent.MessageCreate(content='text only'), ctx)
    assert f'{label} 对话网关返回 HTTP 500' in caught.value.detail
    assert 'private-upstream-detail' not in caught.value.detail
    assert agent._request_catalog.get() is None


@pytest.mark.parametrize('name', ['uniart', 'greena'])
def test_agent_catalog_and_aggregate_catalog_use_same_saved_gateway(monkeypatch, name):
    from src.apps.comic_gen import api
    config = {'catalog_name': name, 'base_url': 'https://gateway.example/v1', 'api_key': 'test'}
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(return_value=config)))
    monkeypatch.setattr(api, 'studio_uniart_config', lambda: config)
    monkeypatch.setattr(provider_catalog, 'urlopen', lambda *args, **kwargs:
                        io.BytesIO(json.dumps({'data': [{'id': 'llm-nf-all'}]}).encode()))
    ctx = UserContext('u', 'p', 'name', 'token')
    agent_models = agent.catalog(ctx)
    aggregate = api.get_uniart_models()
    assert aggregate['provider'] == name
    assert agent_models[0]['id'] == aggregate['models'][0]['id']
    assert agent_models[0]['api_model_id'] == 'llm-nf-all'


def test_saved_gateway_tuple_stays_together_and_explicit_profiles_remain_independent(tmp_path):
    ctx = UserContext('u', 'p', 'name', 'token')
    store = UserConfigStore(str(tmp_path / 'users.db'))
    store.update(ctx, UserConfigUpdate(catalog_name='greena', UNIART_API_KEY='legacy-test', UNIART_BASE_URL='https://legacy.example/v1'))
    store.update_provider_profile(ctx, 'uniart', api_key='uniart-test', base_url='https://uniart.example/v1')
    # A UniArt profile cannot override a GreenA selection.
    assert store.get_runtime_uniart(ctx)['api_key'] == 'legacy-test'
    store.update_provider_profile(ctx, 'greena', api_key='greena-test', base_url='https://greena.example/v1')
    active = store.get_runtime_uniart(ctx)
    assert active['api_key'] == 'legacy-test'
    assert store.get_runtime_nsfw(ctx)['base_url'] == 'https://legacy.example/v1'
    assert store.get_runtime_provider(ctx, 'greena')['api_key'] == 'greena-test'
    assert provider_catalog.catalog_label(active) == 'GreenA Catalog'
    store.update_provider_profile(ctx, 'greena', api_key='')
    with pytest.raises(HTTPException, match='API key is not configured'):
        store.get_runtime_provider(ctx, 'greena')


def test_successful_messages_keep_dispatch_catalog_after_settings_switch(tmp_path, monkeypatch):
    from types import SimpleNamespace
    ctx = UserContext('u', 'p', 'name', 'token')
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.db'))
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'llm-nf-all'}])
    config = {'base_url': 'https://gateway.example/v1', 'api_key': 'test', 'catalog_name': 'uniart'}
    monkeypatch.setattr(agent, 'get_user_config_store', lambda: Mock(get_runtime_uniart=Mock(side_effect=lambda _: dict(config))))
    class Stream:
        def __iter__(self):
            return iter([SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='ok'))])])
        def close(self):
            pass
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=False)
    client.chat.completions.create.side_effect = lambda **kwargs: Stream()
    import openai
    monkeypatch.setattr(openai, 'OpenAI', Mock(return_value=client))
    sid = agent.create(agent.SessionCreate(model='llm-nf-all'), ctx)['session']['id']
    agent.send(sid, agent.MessageCreate(content='first'), ctx)
    config['catalog_name'] = 'greena'
    agent.send(sid, agent.MessageCreate(content='second'), ctx)
    assert [message['catalog_name'] for message in agent.messages(sid, ctx)['messages']] == ['uniart', 'uniart', 'greena', 'greena']
    assert agent._request_catalog.get() is None
