from contextvars import copy_context
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


def test_rewrite_prompt_limits_scope_and_uses_streamed_shared_model():
    from src.apps.comic_gen.script_writing import generate_passage_rewrite

    calls = []
    result = generate_passage_rewrite(
        SimpleNamespace(chat=lambda **kw: calls.append(kw) or '```text\n她松开手。\n```'),
        model='greena/deepseek-v4.1-flash', title='第二集',
        selected_text='她抓住你的衣襟。', before_text='你伸出手。', after_text='梦境碎裂。',
        instruction='让她的反应更克制，保留第二人称视角。',
    )
    assert result == {'draft': '她松开手。', 'mode': 'rewrite', 'title': '第二集'}
    call = calls[0]
    assert call['model'] == 'greena/deepseek-v4.1-flash'
    assert call['stream'] is True and call['timeout_seconds'] == 900
    prompt = call['messages'][1]['content']
    assert '她抓住你的衣襟。' in prompt and '你伸出手。' in prompt and '梦境碎裂。' in prompt
    assert '让她的反应更克制' in prompt
    assert '只输出选中片段的替换正文' in prompt
    assert '不得复述前后文' in call['messages'][0]['content']


@pytest.fixture
def rewrite_client(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext

    owner = UserContext('writer', 'writer-profile', 'Writer', '')
    other = UserContext('other', 'other-profile', 'Other', '')
    monkeypatch.setattr(api, '_TRON_SCRIPT_DOCUMENTS_DIR', tmp_path)
    monkeypatch.setattr(api, '_resolve_request_context', lambda auth, *_: (
        other if auth == 'Bearer other' else owner, False))
    return TestClient(api.app)


@pytest.mark.parametrize('provider', ['greena', 'uniart'])
def test_rewrite_job_preserves_account_model_and_preview_selection(rewrite_client, monkeypatch, provider):
    from src.apps.comic_gen import api
    from src.apps import user_config
    from src.apps.studio_access import current_studio_user, studio_script_model

    client = rewrite_client
    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(
        get_public=lambda _user: {'catalog_name': provider}))
    document = client.post('/script-documents', json={'title': '总纲', 'content': {
        'type': 'doc', 'content': [{'type': 'action', 'content': [{'type': 'text', 'text': '绝不发送整份总纲'}]}],
    }}).json()['id']
    client.put('/script-writing/settings', json={'model': 'deepseek-v4.1-flash'})
    pending = []

    def queue(owner, resource, fingerprint, work):
        context = copy_context()
        pending.append((owner, resource, lambda: context.run(work)))
        return {'id': 'rewrite-1', 'status': 'queued'}

    monkeypatch.setattr(api.extraction_jobs, 'start', queue)
    calls = []

    def chat(**kwargs):
        assert current_studio_user().owner_profile_id == 'writer-profile'
        assert studio_script_model() == provider + '/deepseek-v4.1-flash'
        calls.append(kwargs)
        return '局部新稿'

    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', chat)
    payload = {'script_document_id': document, 'selected_text': '尚未采用的续写预览片段',
               'before_text': '前文', 'after_text': '后文', 'instruction': '加强动作因果'}
    response = client.post('/script-writing/rewrite', json=payload)
    assert response.status_code == 202, response.text
    # Settings changed after submission must not change a queued task's model or owner.
    client.put('/script-writing/settings', json={'model': 'llm-nf-all'})
    owner, resource, run = pending[0]
    assert owner == 'writer-profile' and resource == 'script-writing:document:' + document
    assert run()['draft'] == '局部新稿'
    assert calls[0]['model'] == provider + '/deepseek-v4.1-flash'
    prompt = calls[0]['messages'][1]['content']
    assert payload['selected_text'] in prompt and '绝不发送整份总纲' not in prompt
    assert client.get(f'/script-documents/{document}').json()['content']['content'][0]['content'][0]['text'] == '绝不发送整份总纲'
    assert client.post('/script-writing/rewrite', json=payload, headers={'Authorization': 'Bearer other'}).status_code == 404
    assert len(pending) == 1


def test_rewrite_checks_project_ownership_before_queueing(rewrite_client, monkeypatch):
    from src.apps.comic_gen import api

    queued = []
    monkeypatch.setattr(api.extraction_jobs, 'start', lambda *a, **kw: queued.append(a))
    monkeypatch.setattr(api.pipeline, 'get_script', lambda *_: None)
    response = rewrite_client.post('/script-writing/rewrite', json={
        'project_id': 'foreign-project', 'selected_text': '片段', 'instruction': '改写',
    })
    assert response.status_code == 404 and not queued


@pytest.mark.parametrize('changes', [
    {'selected_text': ''}, {'selected_text': '  '}, {'selected_text': '字' * 12001},
    {'before_text': '字' * 1601}, {'after_text': '字' * 1601}, {'instruction': ''},
    {'instruction': '  '}, {'instruction': '字' * 4001},
    {'project_id': 'both'}, {'script_document_id': None},
])
def test_rewrite_rejects_invalid_or_unbounded_input(rewrite_client, changes):
    payload = {'script_document_id': 'placeholder', 'selected_text': '片段', 'instruction': '修改'}
    response = rewrite_client.post('/script-writing/rewrite', json={**payload, **changes})
    assert response.status_code == 422
