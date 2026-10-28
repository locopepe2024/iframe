import pytest
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Conflict, Missing


def setup(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner','session')['session_id']
    return store, session


def test_bare_edit_request_waits_for_asset_and_brief_without_generation(tmp_path):
    store, session = setup(tmp_path)
    turn = store.claim_turn('owner','actor',session,'start','我们编辑一张图片吧')
    result = store.finish_turn('owner','actor',turn,dict(kind='tool',name='media.draft.start',arguments={'type':'image_edit'}))['result']
    assert result['step']=='awaiting_asset' and result['brief']=='' and result['photo_id'] is None
    assert result['revision']==1 and result['status']=='active'
    next_turn = store.claim_turn('owner','actor',session,'next','调亮一点，其他不变')
    assert next_turn['messages'][-1]['active_media_draft']['task_id']==result['task_id']
    changed=store.finish_turn('owner','actor',next_turn,dict(kind='tool',name='media.draft.update',arguments=dict(task_id=result['task_id'],expected_revision=1,action='brief',brief='调亮一点，其他不变')))['result']
    assert changed['step']=='awaiting_asset' and changed['revision']==2
    with store.connection() as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE name='companion_generations'").fetchone() is None


def test_asset_selection_is_owner_scoped_and_requires_concrete_brief(tmp_path,monkeypatch):
    store, session=setup(tmp_path)
    task=store.start_media_draft('owner','actor',session,'start',dict(type='image_edit'))
    def read(owner,name,args):
        assert owner=='owner' and name=='photo.item.read'
        if args['photo_id']!='allowed': raise Missing('No access')
        return {'photos':[{'photo_id':'allowed'}]}
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos',read)
    with pytest.raises(Missing):
        store.update_media_draft('owner','actor',session,task['task_id'],'bad',dict(expected_revision=1,action='select_photo',photo_id='other'))
    selected=store.update_media_draft('owner','actor',session,task['task_id'],'select',dict(expected_revision=1,action='select_photo',photo_id='allowed'))
    assert selected['step']=='awaiting_brief'
    assert store.update_media_draft('owner','actor',session,task['task_id'],'brief',dict(expected_revision=2,action='brief',brief='调亮'))['step']=='configuring'


def test_retries_revision_isolation_pause_resume_and_restore(tmp_path):
    store,session=setup(tmp_path)
    task=store.start_media_draft('owner','actor',session,'start',dict(type='video_generate',brief='小狗奔跑'))
    assert store.start_media_draft('owner','actor',session,'start',dict(type='video_generate',brief='小狗奔跑'))==task
    with pytest.raises(Conflict): store.start_media_draft('owner','actor',session,'another',dict(type='image_edit'))
    args=dict(expected_revision=1,action='pause')
    paused=store.update_media_draft('owner','actor',session,task['task_id'],'pause',args)
    assert paused['status']=='paused'
    assert store.update_media_draft('owner','actor',session,task['task_id'],'pause',args)==paused
    with pytest.raises(Conflict): store.update_media_draft('owner','actor',session,task['task_id'],'stale',dict(expected_revision=1,action='brief',brief='新的'))
    with pytest.raises(Missing): store.media_draft('owner','different',task['task_id'])
    other=store.session('owner','other')['session_id']
    with pytest.raises(Missing): store.update_media_draft('owner','actor',other,task['task_id'],'cross',dict(expected_revision=2,action='resume'))
    restored=ChatStore(tmp_path/'chat.db').media_draft('owner','actor',task['task_id'])
    assert restored['brief']=='小狗奔跑' and restored['status']=='paused'
    assert store.update_media_draft('owner','actor',session,task['task_id'],'resume',dict(expected_revision=2,action='resume'))['status']=='active'


def test_http_shortcuts_and_stale_voice_context_do_not_call_model(tmp_path,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.companion_runtime.api import router,get_store
    from src.apps.identity import UserContext,require_user_context
    store,session=setup(tmp_path)
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_store]=lambda:store
    app.dependency_overrides[require_user_context]=lambda:UserContext('actor','owner','','')
    def unexpected(*args): raise AssertionError('No model or provider should be called')
    monkeypatch.setattr('src.apps.companion_runtime.api.propose',unexpected)
    monkeypatch.setattr('src.apps.companion_runtime.api.decide',lambda *args:None,raising=False)
    path=f'/companion-runtime/sessions/{session}'
    with TestClient(app) as client:
        result=client.post(path+'/chat',json=dict(operation_id='shortcut',text='/图像编辑',allow_external_text=True))
        assert result.status_code==200,result.text
        task=result.json()['result']
        assert task['brief']=='' and task['step']=='awaiting_asset'
        stale=client.post(path+'/chat',json=dict(operation_id='stale-voice',text='改亮一点',allow_external_text=True,creative_context=dict(task_id='',revision=0)))
        assert stale.status_code==409
        assert client.get(path+'/media-drafts').json()['tasks'][0]['revision']==1
        assert client.post(path+'/media-drafts/input',json=dict(operation_id='pause',task_id=task['task_id'],expected_revision=1,action='pause')).status_code==200
        assert client.post(path+'/media-drafts',json=dict(operation_id='new',type='video_generate')).status_code==200


def test_editor_content_cannot_start_creative_task(tmp_path):
    store,session=setup(tmp_path)
    from src.apps.companion_runtime.interaction_focus import FocusUpdate,update_focus
    update_focus(store,'owner','actor',session,FocusUpdate(operation_id='focus',expected_revision=0,focus=dict(kind='diary',object_id='2026-10-29',phase='editing',draft='今天开发图片生成')))
    claim=store.claim_turn('owner','actor',session,'diary','今天开发图片生成')
    with pytest.raises(ValueError):
        store.finish_turn('owner','actor',claim,dict(kind='tool',name='media.draft.start',arguments=dict(type='image_generate')))


def test_video_reference_modes_keep_distinct_material_slots(tmp_path, monkeypatch):
    store, session = setup(tmp_path)
    task = store.start_media_draft('owner', 'actor', session, 'video', dict(type='video_generate', video_mode='f2v', brief='从春天走到秋天'))
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos':[{}]})
    task = store.update_media_draft('owner', 'actor', session, task['task_id'], 'first', dict(expected_revision=1, action='select_first_photo', photo_id='first'))
    task = store.update_media_draft('owner', 'actor', session, task['task_id'], 'last', dict(expected_revision=2, action='select_last_photo', photo_id='last'))
    assert task['video_mode'] == 'f2v' and task['first_photo_id'] == 'first' and task['last_photo_id'] == 'last'
    task = store.update_media_draft('owner', 'actor', session, task['task_id'], 'mode', dict(expected_revision=3, action='video_mode', video_mode='r2v'))
    task = store.update_media_draft('owner', 'actor', session, task['task_id'], 'add-a', dict(expected_revision=4, action='add_reference_photo', photo_id='a'))
    task = store.update_media_draft('owner', 'actor', session, task['task_id'], 'add-b', dict(expected_revision=5, action='add_reference_photo', photo_id='b'))
    assert task['video_mode'] == 'r2v' and task['reference_photo_ids'] == ['a','b']
