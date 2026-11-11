import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.apps.comic_gen.models import ScriptWritingPlanDraft
from src.apps.comic_gen.script_authoring import analyze_outline, document_text, source_hash


def content(text):
    return {'type': 'doc', 'content': [{'type': 'action', 'content': [{'type': 'text', 'text': text}]}]}


def plan(count=24):
    return ScriptWritingPlanDraft(background='梦境牢笼', style='悬疑', point_of_view='第一视角',
        characters='十二位角色', constraints='不能出现主角面部',
        missing_information=['主角身份'], suggestions=['可增加环境声'],
        episodes=[{'number': n, 'title': f'既定标题{n}', 'outline': f'第{n}集事件',
                   'ending_state': f'第{n}集规划结尾'} for n in range(1, count + 1)]).model_dump()


@pytest.fixture
def client(tmp_path, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps.identity import UserContext
    owner = UserContext('writer', 'writer-profile', 'Writer', '')
    other = UserContext('other', 'other-profile', 'Other', '')
    monkeypatch.setattr(api, '_TRON_SCRIPT_DOCUMENTS_DIR', tmp_path)
    monkeypatch.setattr(api, '_resolve_request_context', lambda auth, *_: (other if auth == 'Bearer other' else owner, False))
    monkeypatch.setattr(api.extraction_jobs, 'start', lambda _owner, _resource, _fp, work, **kwargs:
        {'id': 'test-job', 'status': 'completed', 'result': work()})
    return TestClient(api.app)


def create_plan(client):
    root = client.post('/script-documents', json={'title': '总纲', 'content': content('共24集，第一视角。')}).json()['id']
    path = f'/script-documents/{root}'
    ws = client.get(path + '/writing-plan').json()
    request = {'draft': plan(), 'base_revision': None, 'source_hash': ws['source_hash']}
    result = client.put(path + '/writing-plan', json=request)
    assert result.status_code == 200, result.text
    return root, result.json(), request


def test_analysis_keeps_all_24_episodes_and_source_facts():
    calls = []
    def chat(**kwargs):
        calls.append(kwargs)
        return json.dumps(plan(), ensure_ascii=False)
    result = analyze_outline(SimpleNamespace(chat=chat), '共24集，第一视角，不出现主角面部。')
    assert len(result['draft']['episodes']) == 24
    assert result['draft']['episodes'][23]['title'] == '既定标题24'
    assert result['draft']['suggestions'] == ['可增加环境声']
    assert calls[0]['timeout_seconds'] == 900
    assert calls[0]['stream'] is True
    with pytest.raises(RuntimeError, match='24 集'):
        analyze_outline(SimpleNamespace(chat=lambda **_: json.dumps(plan(1))), '共24集')
    wrong = plan(2)
    wrong['episodes'][1]['number'] = 3
    with pytest.raises(RuntimeError, match='编号无效'):
        analyze_outline(SimpleNamespace(chat=lambda **_: json.dumps(wrong)), '两集')


@pytest.mark.parametrize('prefix,suffix', [
    ('（已激活逆向学习中---）「方案」以下为解析后的剧本写作规划 JSON。\n\n', ''),
    ('以下为完整分集规划：\n```json\n', '\n```'),
    ('```json\n', '\n```'),
], ids=['provider-prose', 'prose-and-fence', 'fence'])
def test_outline_accepts_complete_json_with_provider_commentary(prefix, suffix):
    expected = plan()
    expected['episodes'][0]['source_excerpt'] = '她说：“不要走。”\n手中是信物 {项链}。'
    result = analyze_outline(SimpleNamespace(chat=lambda **_: prefix + json.dumps(expected, ensure_ascii=False) + suffix), '共24集')
    assert result['draft'] == expected


@pytest.mark.parametrize('response', [
    '以下为解析结果：\n' + json.dumps(plan())[:-1],
    json.dumps(plan()) + json.dumps(plan()),
    '以下为结果：' + json.dumps(plan()) + '\n' + json.dumps(plan()),
    '[' + json.dumps(plan()) + ']',
], ids=['truncated', 'two-objects', 'wrapped-two-objects', 'array'])
def test_outline_rejects_truncated_ambiguous_or_array_response(response):
    with pytest.raises(RuntimeError, match='JSON'):
        analyze_outline(SimpleNamespace(chat=lambda **_: response), '共24集')


def test_outline_reports_field_error_separately_from_numbering_error(caplog):
    wrong = plan()
    wrong['characters'] = ['纲手']
    with pytest.raises(RuntimeError, match='字段格式无效.*characters'):
        analyze_outline(SimpleNamespace(chat=lambda **_: json.dumps(wrong)), '共24集')
    assert 'string_type' in caplog.text
    assert '纲手' not in caplog.text


@pytest.mark.parametrize('provider', ['greena', 'uniart'])
def test_model_choice_is_owner_scoped_and_routes_all_writing_operations(client, monkeypatch, provider):
    from src.apps.comic_gen import api
    from src.apps import user_config

    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(
        get_public=lambda _user: {'catalog_name': provider}))
    root, workspace, _ = create_plan(client)
    child = workspace['plan']['episodes'][0]['document_id']
    original_default = api.pipeline.script_processor.llm.default_model
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **kwargs:
        calls.append(kwargs) or (json.dumps(plan()) if '规划助手' in kwargs['messages'][0]['content'] else '正文草稿'))
    assert client.put('/script-writing/settings', json={'model': 'deepseek-v4.1-flash'}).json()['model'] == 'deepseek-v4.1-flash'
    assert client.get('/script-writing/settings').json()['model'] == 'deepseek-v4.1-flash'
    assert client.get('/script-writing/settings', headers={'Authorization': 'Bearer other'}).json()['model'] == 'llm-nf-all'
    assert client.put('/script-writing/settings', json={'model': 'deepseek-v4.1-flash-peak'}).status_code == 422
    assert client.get('/script-writing/settings').json()['model'] == 'deepseek-v4.1-flash'

    response = client.post(f'/script-documents/{root}/outline-analysis')
    assert response.status_code == 202 and len(response.json()['result']['draft']['episodes']) == 24
    assert calls[-1]['model'] == f'{provider}/deepseek-v4.1-flash'
    payload = {'script_document_id': child, 'mode': 'expand_outline', 'source_text': '客户端文本'}
    assert client.post('/script-writing/generate', json=payload).status_code == 202
    assert calls[-1]['model'] == f'{provider}/deepseek-v4.1-flash'
    client.put(f'/script-documents/{child}', json={'content': content('已保存正文')})
    response = client.post('/script-writing/generate', json={**payload, 'mode': 'continue', 'model': 'llm-nf-all'})
    assert response.status_code == 202 and response.json()['result']['mode'] == 'continue'
    assert calls[-1]['model'] == f'{provider}/llm-nf-all'
    assert calls[-1]['stream'] is True
    assert client.get('/script-writing/settings').json()['model'] == 'deepseek-v4.1-flash'
    assert api.pipeline.script_processor.llm.default_model == original_default


def test_queued_outline_keeps_the_model_selected_when_started(client, monkeypatch):
    from src.apps.comic_gen import api
    from src.apps import user_config

    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(
        get_public=lambda _user: {'catalog_name': 'greena'}))
    root, _, _ = create_plan(client)
    pending = []
    monkeypatch.setattr(api.extraction_jobs, 'start', lambda owner, resource, fingerprint, work:
        pending.append(work) or {'id': 'queued', 'status': 'queued'})
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **kwargs:
        calls.append(kwargs) or json.dumps(plan()))
    client.put('/script-writing/settings', json={'model': 'deepseek-v4.1-flash'})
    assert client.post(f'/script-documents/{root}/outline-analysis').status_code == 202
    client.put('/script-writing/settings', json={'model': 'llm-nf-all'})
    pending[0]()
    assert calls[-1]['model'] == 'greena/deepseek-v4.1-flash'
    assert client.post(f'/script-documents/{root}/outline-analysis', json={'model': 'invalid'}).status_code == 422


def test_independent_episode_documents_snapshots_and_reconfirmation(client):
    root, ws, request = create_plan(client)
    episodes = ws['plan']['episodes']
    first, second = [f"/script-documents/{e['document_id']}" for e in episodes[:2]]
    saved = client.put(first, json={'content': content('第一集已写正文'), 'create_snapshot': True}).json()
    assert saved['snapshot_created']
    assert document_text(client.get(second).json()['content']) == ''
    assert document_text(client.get(f'/script-documents/{root}').json()['content']) == '共24集，第一视角。'
    assert len(client.get('/script-documents').json()) == 1
    request['base_revision'] = ws['plan']['revision']
    request['draft']['episodes'][0]['title'] = '修订标题'
    reconfirmed = client.put(f'/script-documents/{root}/writing-plan', json=request).json()
    assert reconfirmed['plan']['episodes'][0]['document_id'] == episodes[0]['document_id']
    assert client.get(first).json()['title'] == '修订标题'
    assert document_text(client.get(first).json()['content']) == '第一集已写正文'
    client.put(first, json={'content': content('修改后正文')})
    restored = client.post(first + '/snapshots/' + saved['snapshot']['timestamp'] + '/restore')
    assert document_text(restored.json()['content']) == '第一集已写正文'
    assert document_text(client.get(second).json()['content']) == ''
    assert client.get(second + '/writing-plan').json()['selected_episode_number'] == 2


def test_stale_revision_source_and_written_episode_removal_are_rejected(client):
    root, ws, request = create_plan(client)
    path = f'/script-documents/{root}'
    assert client.put(path + '/writing-plan', json=request).status_code == 409
    request['base_revision'] = ws['plan']['revision']
    last = ws['plan']['episodes'][-1]['document_id']
    client.put(f'/script-documents/{last}', json={'content': content('不能遗失的正文')})
    request['draft']['episodes'].pop()
    assert client.put(path + '/writing-plan', json=request).status_code == 409
    request['draft'] = plan()
    client.put(path, json={'content': content('总纲变更')})
    assert client.put(path + '/writing-plan', json=request).status_code == 409
    assert client.get(path + '/writing-plan').json()['source_changed']
    assert client.post('/script-writing/generate', json={'script_document_id': last, 'mode': 'expand_outline', 'source_text': '客户端伪造'}).status_code == 409


def test_writing_resolves_selected_title_globals_and_saved_previous_body(client, monkeypatch):
    from src.apps.comic_gen import api
    root, ws, _ = create_plan(client)
    first, second = [item['document_id'] for item in ws['plan']['episodes'][:2]]
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **kw: calls.append(kw) or '新剧本正文')
    def write(id):
        return client.post('/script-writing/generate', json={'script_document_id': id, 'mode': 'expand_outline', 'title': '错误总纲标题', 'source_text': '伪造大纲'})
    assert write(root).status_code == 409
    result = write(second)
    assert result.status_code == 202
    assert result.json()['result']['title'] == '既定标题2'
    prompt = calls[-1]['messages'][1]['content']
    assert '第2集事件' in prompt and '不能出现主角面部' in prompt
    assert '仅为已确认规划' in prompt
    assert '伪造大纲' not in prompt and '错误总纲标题' not in prompt
    client.put(f'/script-documents/{first}', json={'content': content('上一集真正结尾')})
    assert write(second).status_code == 202
    prompt = calls[-1]['messages'][1]['content']
    assert '上一集真正结尾' in prompt and '尚无正文' not in prompt
    continued = client.post('/script-writing/generate', json={'script_document_id': second, 'mode': 'continue', 'source_text': '伪造正文'})
    assert continued.status_code == 202
    assert continued.json()['result']['mode'] == 'expand_outline'
    client.put(f'/script-documents/{second}', json={'content': content('第二集已有正文结尾')})
    continued = client.post('/script-writing/generate', json={'script_document_id': second, 'mode': 'continue', 'source_text': '伪造正文'})
    assert continued.json()['result']['mode'] == 'continue'
    assert '第二集已有正文结尾' in calls[-1]['messages'][1]['content']


def test_owner_boundary_for_planning_analysis_and_episode_writing(client):
    root, ws, request = create_plan(client)
    child = ws['plan']['episodes'][0]['document_id']
    headers = {'Authorization': 'Bearer other'}
    for id in (root, child):
        path = f'/script-documents/{id}'
        assert client.get(path + '/writing-plan', headers=headers).status_code == 404
        assert client.put(path + '/writing-plan', json=request, headers=headers).status_code == 404
        assert client.post(path + '/outline-analysis', headers=headers).status_code == 404
        assert client.get(path + '/outline-analysis/jobs/test-job', headers=headers).status_code == 404
        assert client.post('/script-writing/generate', json={'script_document_id': id, 'mode': 'expand_outline', 'source_text': '文本'}, headers=headers).status_code == 404


def test_delete_root_removes_owned_episodes_and_snapshots_only(client):
    root, ws, _ = create_plan(client)
    child = ws['plan']['episodes'][0]['document_id']
    unrelated = client.post('/script-documents', json={'title': '保留剧本', 'content': content('保留正文')}).json()['id']
    saved = client.put(f'/script-documents/{child}', json={'content': content('已写正文'), 'create_snapshot': True}).json()
    assert saved['snapshot_created']
    assert client.delete(f'/script-documents/{root}', headers={'Authorization': 'Bearer other'}).status_code == 404
    assert client.delete(f'/script-documents/{child}').status_code == 409
    assert client.get(f'/script-documents/{child}').status_code == 200
    result = client.delete(f'/script-documents/{root}')
    assert result.status_code == 200 and result.json()['status'] == 'deleted'
    assert client.get(f'/script-documents/{root}').status_code == 404
    for episode in ws['plan']['episodes']:
        assert client.get(f"/script-documents/{episode['document_id']}").status_code == 404
    assert client.get(f'/script-documents/{child}/snapshots').status_code == 404
    assert client.get(f'/script-documents/{unrelated}').json()['content'] == content('保留正文')
    assert [item['id'] for item in client.get('/script-documents').json()] == [unrelated]
    assert client.delete(f'/script-documents/{root}').status_code == 404


def test_failed_delete_restores_root_and_all_episode_bodies(client, monkeypatch):
    from pathlib import Path
    root, ws, _ = create_plan(client)
    child = ws['plan']['episodes'][0]['document_id']
    client.put(f'/script-documents/{child}', json={'content': content('不可丢失的正文')})
    rename = Path.rename
    def fail_root_move(path, destination):
        if path.name == root and path.parent.name.startswith('.deleted-') is False:
            raise OSError('simulated disk error')
        return rename(path, destination)
    monkeypatch.setattr(Path, 'rename', fail_root_move)
    assert client.delete(f'/script-documents/{root}').status_code == 500
    assert client.get(f'/script-documents/{root}').status_code == 200
    assert client.get(f'/script-documents/{child}').json()['content'] == content('不可丢失的正文')
    assert len(client.get(f'/script-documents/{root}/writing-plan').json()['plan']['episodes']) == 24


def test_episode_original_dialogue_and_emotional_beats_reach_writing_prompt(client, monkeypatch):
    from src.apps.comic_gen import api
    original = '第2集：你故意输掉一局。她挥拳瞬间，你抬起流血的掌心。你说：“这个梦里的血是假的，但你在抖，是真的。”恋爱节点：她抓住你的衣襟，声音变成哀求。'
    root = client.post('/script-documents', json={'title': '完整总纲', 'content': content(original)}).json()['id']
    ws = client.get(f'/script-documents/{root}/writing-plan').json()
    draft = plan(2)
    draft['episodes'][1]['source_excerpt'] = original
    saved = client.put(f'/script-documents/{root}/writing-plan', json={'draft': draft, 'source_hash': ws['source_hash']}).json()
    child = saved['plan']['episodes'][1]['document_id']
    assert client.get(f'/script-documents/{child}/writing-plan').json()['plan']['episodes'][1]['source_excerpt'] == original
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **kw: calls.append(kw) or '本集正文')
    result = client.post('/script-writing/generate', json={'script_document_id': child, 'mode': 'continue', 'source_text': '空白占位'})
    assert result.status_code == 202 and result.json()['result']['mode'] == 'expand_outline'
    prompt = calls[-1]['messages'][1]['content']
    assert original in prompt and '本集原文素材' in prompt
    assert '开场状态' in prompt and '结尾状态' in prompt
    assert '不写其他集剧情' in prompt
    assert client.get(f'/script-documents/{root}').json()['content'] == content(original)
    assert document_text(client.get(f'/script-documents/{child}').json()['content']) == ''


@pytest.mark.parametrize('provider', ['greena', 'uniart'])
def test_shared_selection_freezes_director_and_storyboard_jobs_and_their_cache_keys(client, monkeypatch, provider):
    from contextvars import copy_context
    from src.apps.comic_gen import api
    from src.apps.comic_gen.llm import ScriptProcessor
    from src.apps.comic_gen.models import ArtifactLineage, PromptConfig, Script
    from src.apps.comic_gen.pipeline import ComicGenPipeline
    from src.apps import user_config
    from src.apps.studio_access import studio_script_model

    monkeypatch.setattr(user_config, 'get_user_config_store', lambda: SimpleNamespace(
        get_public=lambda _user: {'catalog_name': provider}))
    processor = ScriptProcessor()
    source = Script(id='project', title='本集', original_text='source', created_at=1, updated_at=1,
                    owner_profile_id='writer-profile', prompt_config=PromptConfig())
    engine = SimpleNamespace(scripts={'project': source}, series_store={}, get_script=lambda _: source,
        script_processor=processor, get_effective_polish_model=lambda _: '',
        director_analysis_context=lambda _: (source, {}, {}),
        storyboard_analysis_context=lambda *args, **kwargs: (source, {}, ''),
        storyboard_visual_style=lambda _: {}, effective_director_profile=lambda _: None,
        storyboard_workflow_lineage=lambda *args: ArtifactLineage(),
        director_shooting_plan_lineage=lambda _: {},
        resolve_episode_assets=lambda _: {'characters': [], 'scenes': [], 'props': []})
    engine.get_effective_storyboard_model = lambda script: ComicGenPipeline.get_effective_storyboard_model(engine, script)
    calls = []
    monkeypatch.setattr(processor.llm, '_get_client', lambda **kwargs: calls.append(kwargs) or object())
    monkeypatch.setattr(processor.llm, '_chat_once', lambda _client, model, *args, **kwargs: model)
    def generate(**kwargs):
        model = processor.llm.chat([{'role': 'user', 'content': 'test'}], model=kwargs.get('model'))
        assert model == studio_script_model().split('/', 1)[1]
        return {'model': model, 'source_cache': processor._director_source_cache_key('source')}
    engine.preview_director_profile_with_audit = lambda *args, **kwargs: {"profile": generate(), "source_audit": {}}
    engine.preview_storyboard_analysis = lambda *args, **kwargs: generate(**kwargs)
    monkeypatch.setattr(api, 'pipeline', engine)
    pending = []
    def queue(owner, resource, fingerprint, work, **kwargs):
        context = copy_context()
        pending.append((fingerprint, lambda: context.run(work, 'test-job') if kwargs.get('pass_job_id') else context.run(work)))
        return {'id': 'test-job', 'status': 'queued'}
    monkeypatch.setattr(api.extraction_jobs, 'start', queue)
    paths = ['/projects/project/director-profile-jobs', '/projects/project/storyboard-analysis-jobs']
    fingerprints = []
    for model in ['deepseek-v4.1-flash', 'llm-nf-all']:
        assert client.put('/script-writing/settings', json={'model': model}).status_code == 200
        for path in paths:
            response = client.post(path, json={'text': 'source'} if 'storyboard' in path else {})
            assert response.status_code == 202, response.text
            fingerprints.append(pending[-1][0])
    assert fingerprints[0] != fingerprints[2]
    assert fingerprints[1] != fingerprints[3]
    # The preference is now LLM; both earlier queued operations still use DeepSeek.
    results = [work() for _, work in pending]
    assert results[0]['profile']['model'] == 'deepseek-v4.1-flash'
    assert results[1]['frames']['model'] == 'deepseek-v4.1-flash'
    assert results[2]['profile']['model'] == 'llm-nf-all'
    assert results[3]['frames']['model'] == 'llm-nf-all'
    assert results[0]['profile']['source_cache'] != results[2]['profile']['source_cache']
    assert calls == [{'gateway': provider}] * 4
    assert source.prompt_config.polish_model == ''
    assert processor.llm.default_model is None


def test_outline_endpoint_checkpoints_stay_in_the_authenticated_document(client, monkeypatch):
    from src.apps.comic_gen import api
    seen = []
    def analyze(_llm, text, **kwargs):
        seen.append((text, kwargs))
        return {'draft': plan(2), 'source_hash': source_hash(text)}
    monkeypatch.setattr(api, 'analyze_outline', analyze)
    root = client.post('/script-documents', json={'title': '总纲', 'content': content('共2集。')}).json()['id']
    assert client.post(f'/script-documents/{root}/outline-analysis').status_code == 202
    assert seen[0][1]['cache_dir'] == api._script_document_dir('writer-profile', root) / 'outline-analysis-cache'
    assert client.post(f'/script-documents/{root}/outline-analysis', headers={'Authorization': 'Bearer other'}).status_code == 404
    assert len(seen) == 1


def test_outline_checkpoint_files_cannot_be_read_through_public_static_route(client, monkeypatch):
    from starlette.responses import PlainTextResponse
    from starlette.staticfiles import StaticFiles
    async def private_file(*_args, **_kwargs):
        return PlainTextResponse('private screenplay checkpoint')
    monkeypatch.setattr(StaticFiles, 'get_response', private_file)
    assert client.get('/files/script_documents/owner/document/outline-analysis-cache/hash/map-0001.json').status_code == 404


def test_interpretation_generation_saves_a_recoverable_draft_without_confirming(client, monkeypatch):
    from src.apps.comic_gen import api
    root = client.post('/script-documents', json={'title': '总纲', 'content': content('共24集。')}).json()['id']
    path = f'/script-documents/{root}'
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **_: json.dumps(plan()))
    result = client.post(path + '/outline-analysis')
    assert result.status_code == 202
    saved = client.get(path + '/writing-plan').json()
    assert saved['plan'] is None
    assert saved['interpretation_draft']['draft'] == plan()
    assert saved['interpretation_draft']['revision'] == result.json()['result']['interpretation_draft']['revision']
    assert len(client.get('/script-documents').json()) == 1
    assert client.post('/script-writing/generate', json={'script_document_id': root, 'mode': 'expand_outline', 'source_text': '占位'}).status_code == 409
    assert client.post('/script-writing/generate', json={'script_document_id': root, 'mode': 'continue', 'source_text': '占位'}).status_code == 409


def test_interpretation_draft_save_confirm_and_conflicts(client):
    root, ws, _ = create_plan(client)
    path = f'/script-documents/{root}'
    draft = plan()
    draft['background'] = '尚未采用的新背景'
    payload = {'draft': draft, 'source_hash': ws['source_hash'], 'base_revision': ws['plan']['revision'], 'base_draft_revision': None}
    response = client.put(path + '/writing-plan/draft', json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['plan']['background'] == '梦境牢笼'
    revision = saved['interpretation_draft']['revision']
    assert client.put(path + '/writing-plan/draft', json=payload).status_code == 409
    assert client.put(path + '/writing-plan', json=payload).status_code == 409
    payload['base_draft_revision'] = revision
    overwritten = client.put(path + '/writing-plan/draft', json=payload)
    assert overwritten.status_code == 200  # Explicit save works even with no text changes.
    assert overwritten.json()['interpretation_draft']['revision'] != revision
    assert client.put(path + '/writing-plan', json=payload).status_code == 409
    payload['base_draft_revision'] = overwritten.json()['interpretation_draft']['revision']
    confirmed = client.put(path + '/writing-plan', json=payload)
    assert confirmed.status_code == 200
    assert confirmed.json()['plan']['background'] == draft['background']
    assert confirmed.json()['interpretation_draft'] is None
    assert confirmed.json()['plan']['episodes'][0]['document_id'] == ws['plan']['episodes'][0]['document_id']


def test_draft_owner_episode_and_stale_source_boundaries(client):
    root, ws, _ = create_plan(client)
    payload = {'draft': plan(), 'source_hash': ws['source_hash'], 'base_revision': ws['plan']['revision']}
    path = f'/script-documents/{root}'
    assert client.put(path + '/writing-plan/draft', json=payload, headers={'Authorization': 'Bearer other'}).status_code == 404
    child = ws['plan']['episodes'][0]['document_id']
    assert client.put(f'/script-documents/{child}/writing-plan/draft', json=payload).status_code == 422
    client.put(path, json={'content': content('已修改总纲')})
    assert client.put(path + '/writing-plan/draft', json=payload).status_code == 409


def test_inflight_interpretation_cannot_replace_newer_draft(client, monkeypatch):
    from src.apps.comic_gen import api
    root, ws, _ = create_plan(client)
    path = f'/script-documents/{root}'
    pending = []
    monkeypatch.setattr(api.extraction_jobs, 'start', lambda owner, resource, fingerprint, work:
        pending.append(work) or {'id': 'queued', 'status': 'queued'})
    monkeypatch.setattr(api, 'analyze_outline', lambda *args, **kw: {'draft': plan(), 'source_hash': ws['source_hash']})
    assert client.post(path + '/outline-analysis').status_code == 202
    revised = plan()
    revised['background'] = '用户在等待时保存的修改'
    assert client.put(path + '/writing-plan/draft', json={'draft': revised, 'source_hash': ws['source_hash'], 'base_revision': ws['plan']['revision']}).status_code == 200
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as failure:
        pending[0]()
    assert failure.value.status_code == 409
    assert client.get(path + '/writing-plan').json()['interpretation_draft']['draft']['background'] == revised['background']


def test_episode_writing_uses_confirmed_interpretation_without_resending_total_outline(client, monkeypatch):
    from src.apps.comic_gen import api
    text = '第1集素材，尚未确认的原文措辞。\n第2集专属原文不应发送。\n' + '其他集大量设定。' * 1000
    root = client.post('/script-documents', json={'title': '总纲', 'content': content(text)}).json()['id']
    ws = client.get(f'/script-documents/{root}/writing-plan').json()
    draft = plan(2)
    draft['episodes'][0]['source_excerpt'] = '已确认第一集对白：“别走。”'
    confirmed = client.put(f'/script-documents/{root}/writing-plan', json={'draft': draft, 'source_hash': ws['source_hash']}).json()
    child = confirmed['plan']['episodes'][0]['document_id']
    calls = []
    monkeypatch.setattr(api.pipeline.script_processor.llm, 'chat', lambda **kw: calls.append(kw) or '本集正文')
    payload = {'script_document_id': child, 'mode': 'expand_outline', 'source_text': '客户端占位'}
    assert client.post('/script-writing/generate', json=payload).status_code == 202
    prompt = calls[-1]['messages'][1]['content']
    assert '第2集专属原文' not in prompt and '其他集大量设定' not in prompt
    assert '<original_outline>' not in prompt
    assert prompt.count(draft['episodes'][0]['source_excerpt']) == 1
    assert prompt.count('第1集事件') == 1
    assert '梦境牢笼' in prompt and '不能出现主角面部' in prompt
    client.put(f'/script-documents/{child}', json={'content': content('本集已写正文')})
    assert client.post('/script-writing/generate', json={**payload, 'mode': 'continue'}).status_code == 202
    prompt = calls[-1]['messages'][1]['content']
    assert '本集已写正文' in prompt
    assert prompt.count(draft['episodes'][0]['source_excerpt']) == 1
    assert '第2集专属原文' not in prompt
