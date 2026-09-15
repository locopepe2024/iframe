from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from src.apps import agent_api as agent
from src.apps.identity import UserContext


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('LUMENX_AGENT_DB', str(tmp_path / 'agent.sqlite3'))
    monkeypatch.setattr(agent, 'catalog', lambda ctx: [{'api_model_id': 'qwen', 'capabilities': ['chat']}])
    return UserContext('user', 'profile', 'name', 'token')


def test_multiturn_owner_and_model(setup, monkeypatch):
    ctx = setup
    session = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']
    sid = session['id']
    call = Mock(return_value='优化后的提示词')
    monkeypatch.setattr(agent, 'complete', call)
    agent.send(sid, agent.MessageCreate(content='一个女孩', asset_names=['参考.png'], context='草稿'), ctx)
    agent.send(sid, agent.MessageCreate(content='加一只小狗'), ctx)
    history = call.call_args.args[2]
    assert len(history) == 4
    assert '参考.png' in history[1]['content']
    assert history[2]['content'] == '优化后的提示词'
    assert len(agent.messages(sid, ctx)['messages']) == 4
    other = UserContext('other', 'other-profile', 'other', 'other-token')
    for fn in [lambda: agent.messages(sid, other), lambda: agent.delete(sid, other), lambda: agent.patch(sid, agent.SessionPatch(title='x'), other)]:
        with pytest.raises(HTTPException) as exc:
            fn()
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException):
        agent.create(agent.SessionCreate(model='image-only'), ctx)
    agent.patch(sid, agent.SessionPatch(title='新的标题'), ctx)
    assert agent.sessions(ctx)['sessions'][0]['title'] == '新的标题'
    agent.delete(sid, ctx)
    assert agent.sessions(ctx)['sessions'] == []


def test_failed_turn_unlocks_and_busy_rejected(setup, monkeypatch):
    ctx = setup
    sid = agent.create(agent.SessionCreate(model='qwen'), ctx)['session']['id']
    monkeypatch.setattr(agent, 'complete', Mock(side_effect=ValueError('secret must not leak')))
    with pytest.raises(HTTPException) as exc:
        agent.send(sid, agent.MessageCreate(content='你好'), ctx)
    assert exc.value.status_code == 502
    assert 'secret' not in exc.value.detail
    assert agent.messages(sid, ctx)['messages'] == []
    with agent.database() as db:
        row, _ = agent.read_session(db, ctx.owner_profile_id, sid)
        assert row['busy'] == 0
        db.execute('UPDATE sessions SET busy=?', (agent.time.time() + 180,))
    with pytest.raises(HTTPException) as exc:
        agent.send(sid, agent.MessageCreate(content='再次发送'), ctx)
    assert exc.value.status_code == 409
