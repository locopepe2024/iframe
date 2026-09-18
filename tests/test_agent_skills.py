from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.apps import agent_api as agent, agent_skills as skills
from src.apps.identity import UserContext, require_user_context


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.sqlite3'))
    return UserContext('user', 'profile', 'name', 'token')


def test_catalog_is_self_contained_and_attributed():
    packages = skills.catalog()
    assert len(packages) == len({p['id'] for p in packages}) == 6
    for p in packages:
        assert len(p['revision']) == 64
        assert len(p['source_revision']) == 40
        assert p['source_revision'] in p['source']
        assert p['source'].startswith('https://github.com/')
        assert p['license_text'] and p['adaptation'] and p['instructions']
        assert '[ref:' not in p['instructions']


def test_h3_skill_keeps_ethnicity_skin_tone_and_skin_condition_independent():
    instructions = next(p['instructions'] for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    assert '国籍和族裔是身份信息，不是固定的五官模板' in instructions
    assert '单数人物定义只建立一个人物身份' in instructions
    assert '它本身不等于活动性痤疮，也不等于大面积重度凹坑' in instructions
    assert 'No skin smoothing, beauty filter, airbrushing, skin lightening, or skin darkening.' in instructions


def test_install_update_toggle_uninstall_owner_isolation(ctx, monkeypatch):
    p = skills.catalog()[0]
    other = UserContext('other', 'other-profile', 'other', 'token')
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    assert len(skills.installed(ctx.owner_profile_id)) == 1
    assert skills.installed(other.owner_profile_id) == []
    with pytest.raises(HTTPException) as exc:
        skills.patch(p['id'], skills.SkillPatch(enabled=False), other)
    assert exc.value.status_code == 404
    skills.uninstall(p['id'], other)
    assert p['instructions'] in skills.creative_guidance(ctx.owner_profile_id)
    skills.patch(p['id'], skills.SkillPatch(enabled=False), ctx)
    assert skills.creative_guidance(ctx.owner_profile_id) == ''
    updated = {**p, 'revision': 'a' * 64, 'instructions': 'New instructions', 'version': '1.1.0'}
    monkeypatch.setattr(skills, 'catalog', lambda: [updated])
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == p['instructions']
    skills.install(p['id'], skills.InstallRequest(revision=updated['revision']), ctx)
    assert skills.installed(ctx.owner_profile_id)[0]['enabled'] is False
    skills.patch(p['id'], skills.SkillPatch(enabled=True), ctx)
    assert 'New instructions' in skills.creative_guidance(ctx.owner_profile_id)
    skills.uninstall(p['id'], ctx)
    assert skills.installed(ctx.owner_profile_id) == []


def test_invalid_packages_revision_and_budget_fail_closed(ctx, monkeypatch):
    p = skills.catalog()[0]
    for skill_id, revision, status in [('not-found', p['revision'], 404), (p['id'], 'b' * 64, 409)]:
        with pytest.raises(HTTPException) as exc:
            skills.install(skill_id, skills.InstallRequest(revision=revision), ctx)
        assert exc.value.status_code == status
    monkeypatch.setattr(skills, 'MAX_GUIDANCE_CHARS', 1)
    with pytest.raises(HTTPException) as exc:
        skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    assert exc.value.status_code == 400
    assert skills.installed(ctx.owner_profile_id) == []


def test_enabled_skills_reach_agent_completion_and_disable_takes_effect(ctx, monkeypatch):
    p = skills.catalog()[0]
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    completion = Mock(return_value='导演方案')
    monkeypatch.setattr(agent, 'complete', completion)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    skills.install(p['id'], skills.InstallRequest(revision=p['revision']), ctx)
    agent.send(sid, agent.MessageCreate(content='设计镜头'), ctx)
    assert p['instructions'] in completion.call_args.args[2][0]['content']
    assert '你不能执行生成' in completion.call_args.args[2][0]['content']
    skills.patch(p['id'], skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='继续'), ctx)
    assert p['instructions'] not in completion.call_args.args[2][0]['content']


def test_http_endpoints_require_identity_and_persist(ctx):
    app = FastAPI()
    app.include_router(agent.router)
    def denied():
        raise HTTPException(401, 'Login required')
    app.dependency_overrides[require_user_context] = denied
    with TestClient(app) as client:
        assert client.get('/agent/skills').status_code == 401
        app.dependency_overrides[require_user_context] = lambda: ctx
        p = client.get('/agent/skills').json()['catalog'][0]
        path = '/agent/skills/' + p['id']
        assert client.post(path, json={'revision': p['revision']}).status_code == 200
        assert client.get('/agent/skills').json()['installed'][0]['enabled'] is True
        assert client.patch(path, json={'enabled': False}).status_code == 200
        assert client.get('/agent/skills').json()['installed'][0]['enabled'] is False
        assert client.delete(path).status_code == 200
        assert client.get('/agent/skills').json()['installed'] == []


def test_skill_changes_apply_across_sessions_without_crossing_owners(ctx, monkeypatch):
    package = skills.catalog()[0]
    other = UserContext('other', 'other-profile', 'name', 'token')
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    complete = Mock(return_value='Creative plan')
    monkeypatch.setattr(agent, 'complete', complete)
    first = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    second = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    foreign = agent.create(agent.SessionCreate(model='qwen'), other)['session']['id']
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    for sid in (first, second):
        agent.send(sid, agent.MessageCreate(content='Director plan'), ctx)
        assert package['instructions'] in complete.call_args.args[2][0]['content']
    agent.send(foreign, agent.MessageCreate(content='Director plan'), other)
    assert package['instructions'] not in complete.call_args.args[2][0]['content']
    skills.uninstall(package['id'], ctx)
    for sid in (first, second):
        agent.send(sid, agent.MessageCreate(content='Continue'), ctx)
        assert package['instructions'] not in complete.call_args.args[2][0]['content']


def test_shared_contract_applies_to_pinned_install_without_replacing_it(ctx, monkeypatch, tmp_path):
    package = next(p for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    saved = skills.installed(ctx.owner_profile_id)[0]
    contract = tmp_path / 'creative-contract.md'
    contract.write_text('Current request defines the creative task.', encoding='utf-8')
    monkeypatch.setattr(skills, 'CATALOG_DIR', tmp_path)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='优化稿')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    agent.send(sid, agent.MessageCreate(content='为H3优化10秒单镜头走秀'), ctx)
    assert contract.read_text() in call.call_args.args[2][0]['content']
    assert saved['instructions'] in call.call_args.args[2][0]['content']
    assert skills.installed(ctx.owner_profile_id)[0] == saved
    skills.patch(package['id'], skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='继续'), ctx)
    assert contract.read_text() not in call.call_args.args[2][0]['content']


def test_file_backed_skill_revision_and_installed_snapshot(ctx, monkeypatch, tmp_path):
    import json
    package = dict(skills.catalog()[-1])
    package['instructions_file'] = 'guide.md'
    (tmp_path / 'catalog.json').write_text(json.dumps({'skills': [package]}))
    (tmp_path / package['license_file']).write_text(package['license_text'])
    guide = tmp_path / 'guide.md'
    guide.write_text('First pinned guide')
    monkeypatch.setattr(skills, 'CATALOG_DIR', tmp_path)
    first = skills.catalog()[0]
    skills.install(first['id'], skills.InstallRequest(revision=first['revision']), ctx)
    guide.write_text('Revised official guide')
    second = skills.catalog()[0]
    assert first['revision'] != second['revision']
    assert second['instructions'] == 'Revised official guide'
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == 'First pinned guide'
    skills.install(second['id'], skills.InstallRequest(revision=second['revision']), ctx)
    assert skills.installed(ctx.owner_profile_id)[0]['instructions'] == 'Revised official guide'


def test_explicit_h3_request_selects_only_h3_and_continue_retains_target(ctx, monkeypatch):
    packages = skills.catalog()
    for package in packages:
        skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='H3 prompt')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    for request in ('将以下提示词优化适合minima H3：仙侠侧踢', '继续'):
        agent.send(sid, agent.MessageCreate(content=request), ctx)
        system = call.call_args.args[2][0]['content']
        for package in packages:
            assert (package['instructions'] in system) == (package['id'] in {'minimax-h3-director', 'h3-product-recreation'})
    agent.send(sid, agent.MessageCreate(content='为Seedance设计镜头'), ctx)
    assert next(p['instructions'] for p in packages if p['id'] == 'minimax-h3-director') not in call.call_args.args[2][0]['content']
    skills.patch('minimax-h3-director', skills.SkillPatch(enabled=False), ctx)
    agent.send(sid, agent.MessageCreate(content='为H3优化'), ctx)
    assert next(p['instructions'] for p in packages if p['id'] == 'minimax-h3-director') not in call.call_args.args[2][0]['content']


def test_h3_clarification_keeps_skill_without_overriding_explicit_new_target(ctx):
    for package in skills.catalog():
        skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    history = [
        {'role': 'user', 'content': '将仙侠侧踢优化适合minima H3'},
        {'role': 'assistant', 'content': '为了按 MiniMax H3 编排，请补充视频总时长和是否允许切镜。'},
    ]
    guidance = skills.creative_guidance(ctx.owner_profile_id, '1. **视频总时长15 秒 2、允许切镜。', history)
    h3 = next(p for p in skills.catalog() if p['id'] == 'minimax-h3-director')
    assert h3['instructions'] in guidance
    assert '[Seedance' not in guidance
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '改为Seedance，15秒允许切镜', history)
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '帮我写一封邮件', history)
    skills.patch(h3['id'], skills.SkillPatch(enabled=False), ctx)
    assert h3['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '15秒允许切镜', history)


def test_product_recreation_installs_alone_reaches_chat_and_respects_target(ctx, monkeypatch):
    package = next(p for p in skills.catalog() if p['id'] == 'h3-product-recreation')
    skills.install(package['id'], skills.InstallRequest(revision=package['revision']), ctx)
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen'}])
    call = Mock(return_value='参考再生成提示词')
    monkeypatch.setattr(agent, 'complete', call)
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    for request in ('用H3参考视频，把商品换成图片中的商品，口播名称换为新商品名', '继续'):
        agent.send(sid, agent.MessageCreate(content=request), ctx)
        assert package['instructions'] in call.call_args.args[2][0]['content']
    assert package['instructions'] in skills.creative_guidance(ctx.owner_profile_id, '参考原片重新生成并替换商品')
    assert package['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '改为Seedance复刻视频')
    assert package['instructions'] not in skills.creative_guidance('other-owner', '用H3换商品')
    skills.patch(package['id'], skills.SkillPatch(enabled=False), ctx)
    assert package['instructions'] not in skills.creative_guidance(ctx.owner_profile_id, '用H3换商品')
