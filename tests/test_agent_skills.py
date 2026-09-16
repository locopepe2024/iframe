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
    assert len(packages) == len({p['id'] for p in packages}) == 5
    for p in packages:
        assert len(p['revision']) == 64
        assert len(p['source_revision']) == 40
        assert p['source_revision'] in p['source']
        assert p['source'].startswith('https://github.com/')
        assert p['license_text'] and p['adaptation'] and p['instructions']
        assert '[ref:' not in p['instructions']


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
