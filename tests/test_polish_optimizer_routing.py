from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src.apps.comic_gen import api
from src.apps import user_config
from src.apps.studio_access import set_studio_script_model, reset_studio_script_model


@pytest.fixture
def greena(monkeypatch):
    user = SimpleNamespace(user_id='kent', owner_profile_id='kent-profile')
    monkeypatch.setattr(api, 'current_studio_user', lambda: user)
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(
        get_public=lambda owner: {'catalog_name': 'greena'}))
    monkeypatch.setattr(api, '_get_custom_prompt', lambda *a: '')
    monkeypatch.setattr(api, '_get_director_prompt_context', lambda *a: '')
    return user


def test_greena_optimizer_catalog_excludes_uniart(greena):
    config = api.get_video_polish_optimizers()
    assert config['default_provider'] == 'local_llm'
    assert [p['id'] for p in config['providers']] == ['local_llm', 'llm', 'deepseek']


@pytest.mark.parametrize('reference', [False, True])
@pytest.mark.parametrize('provider,model', [('llm', 'llm-nf-all'), ('deepseek', 'deepseek-v4.1-flash')])
def test_greena_polish_routes_text_independently_of_target(greena, monkeypatch, reference, provider, model):
    processor = Mock()
    method = processor.polish_r2v_prompt if reference else processor.polish_video_prompt
    method.return_value = {'prompt_cn': '中文镜头', 'prompt_en': 'English shot'}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    cls = api.PolishR2VPromptRequest if reference else api.PolishVideoPromptRequest
    request = cls(draft_prompt='镜头', optimizer_provider=provider, target_video_model='uniart/wan-3.0', **({'slots': []} if reference else {}))
    preview = api._compile_video_polish_review(request, reference)
    confirmed = request.model_copy(update={'review_token': preview['review_token'], 'reviewed_messages': preview['messages']})
    (api.polish_r2v_prompt if reference else api.polish_video_prompt)(confirmed)
    assert method.call_args.kwargs['polish_model'] == f'greena/{model}'


def test_workspace_model_is_frozen_and_bound_to_review(greena):
    request = api.PolishVideoPromptRequest(draft_prompt='镜头')
    token = set_studio_script_model('greena/deepseek-v4.1-flash')
    try:
        assert api._resolve_video_polish_model(request) == 'greena/deepseek-v4.1-flash'
        preview = api._compile_video_polish_review(request, False)
    finally:
        reset_studio_script_model(token)
    token = set_studio_script_model('greena/llm-nf-all')
    try:
        assert api._compile_video_polish_review(request, False)['review_token'] != preview['review_token']
    finally:
        reset_studio_script_model(token)


@pytest.mark.parametrize('provider,override', [('qwen', ''), ('minimax_context_ir', ''), ('deepseek', 'uniart/deepseek-v4.1-flash'), ('llm', 'greena/deepseek-v4.1-flash')])
def test_greena_rejects_stale_or_foreign_optimizer_before_call(greena, monkeypatch, provider, override):
    processor = Mock()
    monkeypatch.setattr(api, 'ScriptProcessor', processor)
    request = api.PolishVideoPromptRequest(draft_prompt='镜头', optimizer_provider=provider, polish_model=override)
    with pytest.raises(api.HTTPException) as exc:
        api._compile_video_polish_review(request, False)
    assert exc.value.status_code == 422
    processor.assert_not_called()


def test_uniart_retains_named_models_and_official_ir(greena, monkeypatch):
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(get_public=lambda _: {'catalog_name': 'uniart'}))
    assert api.get_video_polish_optimizers()['default_provider'] == 'qwen'
    assert api._resolve_video_polish_model(api.PolishVideoPromptRequest(draft_prompt='镜头', optimizer_provider='deepseek')) == 'uniart/deepseek-v4.1-flash'
    assert api._resolve_video_polish_model(api.PolishVideoPromptRequest(draft_prompt='镜头', optimizer_provider='minimax_context_ir')) == ''


def test_http_polish_uses_each_owners_greena_key_and_workspace_model(tmp_path, monkeypatch):
    import json
    import sys
    from fastapi.testclient import TestClient
    from src.apps.identity import UserContext
    from src.apps.user_config import UserConfigStore, UserConfigUpdate

    users = {name: UserContext(name, name + '-profile', name, '') for name in ('kent', 'ola')}
    store = UserConfigStore(str(tmp_path / 'users.db'))
    for name, user in users.items():
        store.update(user, UserConfigUpdate(catalog_name='greena', UNIART_API_KEY='test-' + name,
                                           UNIART_BASE_URL='https://' + name + '.test/v1'))
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: store)
    monkeypatch.setattr(api, '_TRON_SCRIPT_DOCUMENTS_DIR', tmp_path / 'documents')
    monkeypatch.setattr(api, '_resolve_request_context', lambda auth, *_: (users[auth.removeprefix('Bearer ')], False))
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('OPENAI_API_KEY', 'shared-key-must-not-be-used')
    api._authoring_store(users['kent']).set_writing_model('deepseek-v4.1-flash')
    api._authoring_store(users['ola']).set_writing_model('llm-nf-all')
    calls = []

    class Client:
        def __init__(self, api_key, base_url):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: (
                calls.append((api_key, base_url, kw['model'])) or SimpleNamespace(choices=[SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps({'prompt_cn': '安静长街', 'prompt_en': 'A quiet street'})))]))))

    monkeypatch.setitem(sys.modules, 'openai', SimpleNamespace(OpenAI=Client))
    with TestClient(api.app) as client:
        for name in ('kent', 'ola', 'kent'):
            headers = {'Authorization': 'Bearer ' + name}
            config = client.get('/video/polish_prompt/optimizers', headers=headers)
            assert config.status_code == 200, config.text
            assert config.json()['default_provider'] == 'local_llm'
            data = {'draft_prompt': '安静长街', 'target_video_model': 'uniart/wan-3.0'}
            preview = client.post('/video/polish_prompt/preview', json=data, headers=headers)
            assert preview.status_code == 200, preview.text
            confirmed = client.post('/video/polish_prompt', json={**data,
                'review_token': preview.json()['review_token'], 'reviewed_messages': preview.json()['messages']}, headers=headers)
            assert confirmed.status_code == 200, confirmed.text
    assert calls == [
        ('test-kent', 'https://kent.test/v1', 'deepseek-v4.1-flash'),
        ('test-ola', 'https://ola.test/v1', 'llm-nf-all'),
        ('test-kent', 'https://kent.test/v1', 'deepseek-v4.1-flash'),
    ]


def test_queued_optimizer_keeps_the_reviewed_workspace_model(greena, monkeypatch):
    from contextvars import copy_context
    processor = Mock()
    processor.polish_video_prompt.return_value = {'prompt_cn': '中文镜头', 'prompt_en': 'English shot'}
    monkeypatch.setattr(api, 'ScriptProcessor', lambda: processor)
    monkeypatch.setattr(api, 'pipeline', SimpleNamespace(get_script=lambda *_: SimpleNamespace(frames=[])))
    pending = []
    def start(_owner, _resource, _fingerprint, work):
        pending.append((copy_context(), work))
        return {'id': 'queued'}
    monkeypatch.setattr(api, 'extraction_jobs', SimpleNamespace(start=start))
    request = api.PolishVideoPromptRequest(draft_prompt='镜头', script_id='project')
    token = set_studio_script_model('greena/deepseek-v4.1-flash')
    try:
        preview = api._compile_video_polish_review(request, False)
        confirmed = request.model_copy(update={'review_token': preview['review_token'], 'reviewed_messages': preview['messages']})
        assert api._start_polish_job('project', confirmed, 'video', greena.owner_profile_id)['id'] == 'queued'
    finally:
        reset_studio_script_model(token)
    token = set_studio_script_model('greena/llm-nf-all')
    try:
        context, work = pending[0]
        assert context.run(work)['prompt_cn'] == '中文镜头'
    finally:
        reset_studio_script_model(token)
    assert processor.polish_video_prompt.call_args.kwargs['polish_model'] == 'greena/deepseek-v4.1-flash'


def test_review_is_rejected_after_switching_owners(greena, monkeypatch):
    request = api.PolishVideoPromptRequest(draft_prompt='镜头', optimizer_provider='llm')
    preview = api._compile_video_polish_review(request, False)
    confirmed = request.model_copy(update={'review_token': preview['review_token'], 'reviewed_messages': preview['messages']})
    monkeypatch.setattr(api, 'current_studio_user', lambda: SimpleNamespace(user_id='ola', owner_profile_id='ola-profile'))
    with pytest.raises(api.HTTPException) as rejected:
        api._require_video_polish_review(confirmed, False)
    assert rejected.value.status_code == 409


def test_project_model_fallback_resolves_project_and_series_with_same_owner(greena, monkeypatch):
    get_script = Mock(return_value=SimpleNamespace(prompt_config=None, series_id='series'))
    get_series = Mock(return_value=SimpleNamespace(prompt_config=SimpleNamespace(polish_model='qwen3.6-plus')))
    monkeypatch.setattr(api, 'pipeline', SimpleNamespace(get_script=get_script, get_series=get_series))
    assert api._get_polish_model_for_project('project') == 'qwen3.6-plus'
    get_script.assert_called_once_with('project', greena.owner_profile_id)
    get_series.assert_called_once_with('series', greena.owner_profile_id)
