from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.companion_runtime.api import router, get_store
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime import planner_runtime
from src.apps.companion_runtime.store import Conflict
from src.apps.identity import UserContext, require_user_context


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    store = ChatStore(tmp_path/'chat.db', initialize=True)
    session = store.session('owner', 'start')['session_id']
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[require_user_context] = lambda: UserContext('actor','owner','','')
    monkeypatch.setenv('IFRAME_COMPANION_PLANNER_URL', 'http://local.test/completions')
    planner = Mock(return_value={'decision': {'kind':'delegate','capability':'chat'}})
    monkeypatch.setattr(planner_runtime, 'propose_local', planner)
    cloud = Mock(return_value={'kind':'text','text':'我们慢慢聊。'})
    monkeypatch.setattr('src.apps.companion_runtime.api.propose', cloud)
    with TestClient(app) as client:
        yield store, session, client, planner, cloud


def send(runtime, operation='request'):
    _, session, client, _, _ = runtime
    return client.post(f'/companion-runtime/sessions/{session}/chat', json={
        'operation_id':operation, 'text':'修改照片，换黑色长袍，其他不变，从相册选', 'allow_external_text':True})


def proposal(*steps):
    return {'decision': {'kind':'image_edit','steps':list(steps)}}


def test_compound_plan_executes_brief_before_wait_and_retries_without_model(runtime):
    store, session, _, planner, cloud = runtime
    planner.return_value = proposal({'tool':'media.task.ensure'},
                                    {'tool':'media.brief.set','brief':'换黑色长袍，其他不变'},
                                    {'tool':'media.source.request','source':'album'})
    response = send(runtime)
    assert response.status_code == 200, response.text
    result = response.json()['result']
    assert result['brief'] == '换黑色长袍，其他不变'
    assert result['ui_action'] == 'open_album'
    assert result['execution']['status'] == 'waiting_user'
    assert [s['status'] for s in result['execution']['steps']] == ['succeeded','succeeded','waiting_user']
    assert store.media_draft('owner','actor',result['task_id'])['brief'] == result['brief']
    assert send(runtime).json() == response.json()
    planner.assert_called_once()
    cloud.assert_not_called()


def test_paused_task_resumes_in_same_task_and_retains_requirements(runtime):
    store, session, _, planner, _ = runtime
    task = store.start_media_draft('owner','actor',session,'start',{'type':'image_edit','brief':'人物不变'})
    store.update_media_draft('owner','actor',session,task['task_id'],'pause',{'action':'pause','expected_revision':1})
    planner.return_value = proposal({'tool':'media.task.resume'}, {'tool':'media.source.request','source':'upload'})
    response = send(runtime)
    assert response.status_code == 200, response.text
    result = response.json()['result']
    assert result['task_id'] == task['task_id'] and result['status'] == 'active'
    assert result['brief'] == '人物不变' and result['ui_action'] == 'open_upload'


def test_invalid_plan_delegates_and_never_executes(runtime):
    store, _, _, planner, cloud = runtime
    # Simulate a validated inference boundary rejecting invalid JSON/steps.
    planner.side_effect = ValueError('invalid tools')
    response = send(runtime)
    assert response.status_code == 200
    assert response.json()['result']['kind'] == 'text'
    cloud.assert_called_once()
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM companion_media_drafts').fetchone()[0] == 0


def test_execute_revalidates_model_decision_before_any_mutation(runtime):
    store, session, _, _, _ = runtime
    claim = store.claim_turn('owner','actor',session,'invalid','修改照片')
    with pytest.raises(ValueError):
        store.finish_turn('owner','actor',claim,dict(kind='local_plan',**proposal(
            {'tool':'media.task.ensure'}, {'tool':'media.source.request','source':'album','brief':'bad'})))
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM companion_media_drafts').fetchone()[0] == 0


def test_mid_plan_failure_rolls_back_draft_and_step_receipts(runtime, monkeypatch):
    store, session, _, _, _ = runtime
    claim = store.claim_turn('owner','actor',session,'atomic','修改照片')
    def fail(*args, **kwargs):
        raise Conflict('injected source failure')
    monkeypatch.setattr(ChatStore, 'update_media_draft', fail)
    with pytest.raises(Conflict):
        store.finish_turn('owner','actor',claim,dict(kind='local_plan',**proposal(
            {'tool':'media.task.ensure'}, {'tool':'media.source.request','source':'album'})))
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM companion_media_drafts').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM companion_media_draft_operations').fetchone()[0] == 0


def test_revision_conflict_does_not_rebase_plan(runtime):
    store, session, _, _, _ = runtime
    task = store.start_media_draft('owner','actor',session,'start',{'type':'image_edit','brief':'原要求'})
    claim = store.claim_turn('owner','actor',session,'stale','换黑袍')
    store.update_media_draft('owner','actor',session,task['task_id'],'other',{'action':'brief','expected_revision':1,'brief':'新要求'})
    with pytest.raises(Conflict):
        store.finish_turn('owner','actor',claim,dict(kind='local_plan',**proposal({'tool':'media.brief.set','brief':'换黑袍'})))
    assert store.media_draft('owner','actor',task['task_id'])['brief'] == '新要求'


def test_editor_bypasses_media_planner(runtime):
    store, session, _, planner, _ = runtime
    from src.apps.companion_runtime.interaction_focus import update_focus
    update_focus(store,'owner','actor',session,dict(operation_id='focus',expected_revision=0,focus=dict(kind='diary',object_id='2026-10-29',phase='editing')))
    assert send(runtime).status_code == 200
    planner.assert_not_called()


def test_video_plan_creates_video_draft_and_frame_card(runtime):
    store, session, _, planner, _ = runtime
    planner.return_value = {'decision': {'kind':'video_generate','steps':[
        {'tool':'media.task.ensure','type':'video_generate'},
        {'tool':'media.brief.set','brief':'让小狗跑起来'},
        {'tool':'media.video.mode','mode':'f2v'},
        {'tool':'media.source.request','source':'album','slot':'first_frame'},
    ]}}
    response = send(runtime, operation='video')
    # The fixture request text is image oriented; planner result is the source of truth.
    assert response.status_code == 200, response.text
    result=response.json()['result']
    assert result['type']=='video_generate' and result['video_mode']=='f2v'
    assert result['brief']=='让小狗跑起来' and result['step']=='configuring'
    assert result['asset_card']['slot']=='first_frame'
    assert result['execution']['status']=='waiting_user'
