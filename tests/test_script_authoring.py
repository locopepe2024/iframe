import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.apps.comic_gen.models import ScriptWritingPlanDraft
from src.apps.comic_gen.script_authoring import analyze_outline, document_text


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
    with pytest.raises(RuntimeError, match='24 集'):
        analyze_outline(SimpleNamespace(chat=lambda **_: json.dumps(plan(1))), '共24集')
    wrong = plan(2)
    wrong['episodes'][1]['number'] = 3
    with pytest.raises(RuntimeError, match='编号无效'):
        analyze_outline(SimpleNamespace(chat=lambda **_: json.dumps(wrong)), '两集')


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
    assert continued.status_code == 422  # Empty saved body cannot be continued.


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
