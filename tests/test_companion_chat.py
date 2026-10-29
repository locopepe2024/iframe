from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.apps.companion_runtime.api import router,get_store
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Conflict
from src.apps.companion_runtime import model
from src.apps.identity import UserContext,require_user_context


@pytest.fixture
def chat(tmp_path,monkeypatch):
    now=[1000.];store=ChatStore(tmp_path/'chat.db',initialize=True,clock=lambda:now[0])
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_store]=lambda:store
    app.dependency_overrides[require_user_context]=lambda:UserContext('actor','owner','','')
    session=store.session('owner','s')['session_id']
    callback=Mock(side_effect=lambda identity,messages,mid:dict(kind='tool',name='memory.save',arguments=dict(source_message_id=mid,quote='喜欢散步',content='喜欢散步',type='preference',importance=3)))
    monkeypatch.setattr('src.apps.companion_runtime.api.propose',callback)
    monkeypatch.setattr('src.apps.companion_runtime.api.propose_diary',callback)
    with TestClient(app) as client:yield store,now,client,session,callback


def request(client,session,**extra):
    return client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(operation_id='turn',text='请记住我喜欢散步',allow_external_text=True,**extra))


def test_model_proposal_final_confirmation_retry_and_closed_turn(chat):
    store,_,client,session,callback=chat
    response=request(client,session)
    assert response.status_code==200,response.text
    result=response.json();assert result['result']['status']=='pending_confirmation'
    assert store.memories('owner')['memories']==[]
    assert request(client,session).json()==result
    assert callback.call_count==1
    body=dict(operation_id='save',preview_token=result['result']['preview_token'],method='button')
    assert client.post('/companion-runtime/confirmations',json=body).status_code==200
    reread=client.get('/companion-runtime/turns/'+result['turn_id']).json()
    assert reread['result']['status']=='preview_closed' and '喜欢散步' not in str(reread)
    assert len(store.memories('owner')['memories'])==1
    assert client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(operation_id='turn',text='改了',allow_external_text=True)).status_code==409


def test_no_permission_no_model_and_failed_request_retry(chat):
    store,_,client,session,callback=chat
    assert client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(operation_id='x',text='hi',allow_external_text=False)).status_code==422
    callback.assert_not_called()
    callback.side_effect=model.ModelUnavailable('private upstream')
    assert request(client,session).status_code==503
    assert len(store.messages('owner',session)['messages'])==1
    callback.side_effect=None;callback.return_value=dict(kind='text',text='我们慢慢聊。')
    assert request(client,session).json()['result']==dict(kind='text',text='我们慢慢聊。')
    assert len(store.messages('owner',session)['messages'])==1


def test_upload_question_returns_card_without_memory_model_call(chat):
    _,_,client,session,callback=chat
    response=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='upload-help', text='怎么发', allow_external_text=True))
    assert response.status_code==200
    assert response.json()['result']==dict(kind='upload_guide')
    callback.assert_not_called()


def test_workflow_context_is_bounded_and_read_only(chat):
    store, _, client, session, _ = chat
    response = client.get(f'/companion-runtime/sessions/{session}/workflow-context')
    assert response.status_code == 200, response.text
    context = response.json()
    assert context['session_id'] == session
    assert context['focused_task'] is None
    assert context['album_tasks'] == []
    assert context['recent_diaries'] == []


def test_coordinator_decision_is_passed_as_context_only(chat, monkeypatch):
    _, _, client, session, callback = chat
    callback.reset_mock()
    callback.side_effect = None
    callback.return_value = dict(kind='text', text='我们先看看相册。')
    monkeypatch.setattr('src.apps.companion_runtime.api.decide', lambda text, context: {
        'focus': 'album', 'action': 'open_or_select', 'need_clarification': False, 'source': 'model'})
    response = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='coordinator-context', text='我想看看照片', allow_external_text=True))
    assert response.status_code == 200, response.text
    assert callback.call_args.args[1][-1]['coordinator_decision']['focus'] == 'album'


def test_diary_request_never_surfaces_an_accidental_memory_read(chat):
    store,_,client,session,callback=chat
    callback.return_value=dict(kind='tool',name='memory.search',arguments=dict(query='2026-10-24',limit=20,min_importance=1,type=None,cursor=''))
    response=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='diary', text='把 2026-10-24 我们聊的内容整理成一篇回忆日记。', allow_external_text=True))
    assert response.status_code==200
    assert response.json()['result']==dict(kind='text',text='我会按这个日期整理回忆日记。现在还缺少可以整理的聊天内容，请先告诉我这一天发生了什么。')


def test_diary_writer_receives_existing_session_user_context(chat):
    store,_,client,session,callback=chat
    callback.reset_mock()
    callback.side_effect=None
    callback.return_value=dict(kind='text',text='今天女儿来看我，我们一起喝了茶。')
    first=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='fact', text='今天女儿来看我了，我们一起喝茶。', allow_external_text=True))
    assert first.status_code==200
    diary=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='diary-context', text='把 2026-10-24 我们聊的内容整理成一篇回忆日记。', allow_external_text=True))
    assert diary.status_code==200
    assert diary.json()['result']['text']=='今天女儿来看我，我们一起喝了茶。'
    assert callback.call_args.args[1][-1]['text']=='把 2026-10-24 我们聊的内容整理成一篇回忆日记。'
    assert any(item['text']=='今天女儿来看我了，我们一起喝茶。' for item in callback.call_args.args[1])

    callback.return_value=dict(kind='text',text='实际记忆查询结果：没有匹配的记忆。')
    response=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='diary-text', text='请把 2026-10-24 我们聊的内容整理成一篇回忆日记。', allow_external_text=True))
    assert response.json()['result']==dict(kind='text',text='我会按这个日期整理回忆日记。现在还缺少可以整理的聊天内容，请先告诉我这一天发生了什么。')


def test_claim_reclaim_old_worker_and_invalid_source_never_writes(chat):
    store,now,_,session,_=chat
    claim=store.claim_turn('owner','actor',session,'one','我喜欢散步')
    with pytest.raises(Conflict):store.claim_turn('owner','actor',session,'one','我喜欢散步')
    now[0]+=121
    newer=store.claim_turn('owner','actor',session,'one','我喜欢散步')
    with pytest.raises(Conflict):store.finish_turn('owner','actor',claim,dict(kind='text',text='旧结果'))
    with pytest.raises(ValueError):store.finish_turn('owner','actor',newer,dict(kind='tool',name='memory.save',arguments=dict(source_message_id='wrong',quote='喜欢散步',content='喜欢散步',type='preference',importance=3)))
    assert store.memories('owner')['memories']==[]
    with store.connection() as db:assert db.execute('SELECT COUNT(*) FROM companion_memory_previews').fetchone()[0]==0


def test_deleted_memory_not_in_historical_read_turn(chat):
    store,_,client,session,callback=chat
    proposal=request(client,session).json()['result']
    saved=store.confirm('owner','actor',proposal['preview_token'],'save')
    callback.side_effect=None;callback.return_value=dict(kind='tool',name='memory.search',arguments=dict(query='散步'))
    read=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(operation_id='read',text='我记过散步吗',allow_external_text=True)).json()
    assert read['result']['memories'][0]['id']==saved['memory_id']
    deletion=store.prepare('owner','actor','delete',dict(memory_id=saved['memory_id']))
    store.confirm('owner','actor',deletion['preview_token'],'delete')
    assert client.get('/companion-runtime/turns/'+read['turn_id']).json()['result']['memories']==[]
    # A vague delete request must not allow arbitrary model-chosen identities.
    callback.return_value=dict(kind='tool',name='memory.delete',arguments=dict(memory_id='not-explicit'))
    assert client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(operation_id='bad',text='删那条',allow_external_text=True)).status_code==422


def test_personal_channel_wire_strict_tools_and_safe_failure(monkeypatch):
    configured=Mock();configured.get_public.return_value={'secrets_configured':{'UNIART_API_KEY':True}}
    configured.get_runtime_uniart.return_value={'base_url':'https://example.test/v1','api_key':'personal-secret'}
    monkeypatch.setenv('IFRAME_COMPANION_USER_CONFIG_DB','/tmp/users.db')
    monkeypatch.setattr(model,'UserConfigStore',Mock(return_value=configured))
    response=Mock();response.json.return_value={'choices':[{'message':{'tool_calls':[dict(type='function',function=dict(name='memory_search',arguments='{"query":"散步"}'))]}}]}
    post=Mock(return_value=response);monkeypatch.setattr(model.requests,'post',post)
    identity=UserContext('actor','owner','','')
    assert model.propose(identity,[dict(id='m',text='散步')],'m')==dict(kind='tool',name='memory.search',arguments=dict(query='散步'))
    response.json.return_value={'choices':[{'message':{'content':'今天女儿来看我，我们一起喝了茶。'}}]}
    diary=model.propose_diary(identity,[dict(id='m',text='女儿今天来看我了。')],'m')
    assert diary==dict(kind='text',text='今天女儿来看我，我们一起喝了茶。')
    assert 'tools' not in post.call_args.kwargs['json']
    body=post.call_args.kwargs['json']
    assert body['parallel_tool_calls'] is False
    # The previous regular proposal still carried the memory and photo tools.
    regular_body=post.call_args_list[0].kwargs['json']
    assert {t['function']['name'] for t in regular_body['tools']}=={'media_draft_start','media_draft_update','diary_save_draft','diary_open','diary_list','diary_read','memory_save','memory_search','memory_list','memory_delete','photo_album_count','photo_album_list','photo_item_read','photo_organize_start','photo_organize_input','photo_action'}
    assert regular_body['max_tokens'] < body['max_tokens']
    assert 'confirm' not in str(regular_body['tools'])
    response.json.return_value={'choices':[{'message':{'tool_calls':[dict(type='function',function=dict(name='memory_confirm',arguments='{}'))]}}]}
    with pytest.raises(model.ModelUnavailable):model.propose(identity,[],'m')
    configured.get_public.return_value={'secrets_configured':{'UNIART_API_KEY':False}}
    from fastapi import HTTPException
    with pytest.raises(HTTPException):model.propose(identity,[],'m')
    assert post.call_count==3


def test_conversation_history_pairs_replies_and_enforces_owner_actor(chat):
    store,_,client,session,callback=chat
    callback.side_effect=None
    callback.return_value=dict(kind='text',text='你们一起做了什么？')
    result=request(client,session).json()
    page=client.get(f'/companion-runtime/sessions/{session}/conversation').json()
    assert page['messages'][0]['turn']==result
    assert store.conversation('owner','someone-else',session)['messages'][0].get('turn') is None
    from src.apps.companion_runtime.store import Missing
    with pytest.raises(Missing):store.conversation('other-owner','actor',session)


def test_recent_conversation_pages_keep_latest_results_and_older_history(chat):
    store, _, client, session, callback = chat
    callback.side_effect = None
    callback.return_value = dict(kind='text', text='我们一起整理。')
    for index in range(25):
        result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
            operation_id=f'recent-{index}', text=f'整理照片 {index}', allow_external_text=True))
        assert result.status_code == 200
    latest = client.get(f'/companion-runtime/sessions/{session}/conversation?latest=true').json()
    assert len(latest['messages']) == 20
    assert latest['messages'][0]['text'] == '整理照片 5'
    assert latest['messages'][-1]['text'] == '整理照片 24'
    assert latest['messages'][-1]['turn']['result']['text'] == '我们一起整理。'
    older = client.get(f'/companion-runtime/sessions/{session}/conversation?before={latest["next_before"]}').json()
    assert [m['text'] for m in older['messages']] == [f'整理照片 {i}' for i in range(5)]
    assert older['next_before'] is None
    # Preserve the forward pagination contract for existing callers.
    original = client.get(f'/companion-runtime/sessions/{session}/conversation').json()
    assert original['messages'][0]['text'] == '整理照片 0'
    assert original['next_after'] is not None
    assert client.get(f'/companion-runtime/sessions/{session}/conversation?before=0').status_code == 422


@pytest.mark.parametrize('text', ['梳理相册', '帮我整理照片', '我想整理一下我的相册'])
def test_generic_album_request_asks_scope_without_model_or_photo_read(chat, text):
    store, _, client, session, callback = chat
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='album-scope', text=text, allow_external_text=True))
    assert result.status_code == 200, result.text
    assert result.json()['result']['kind'] == 'album_guide'
    callback.assert_not_called()
    assert store.workflow_context('owner', 'actor', session)['album_tasks'] == []


@pytest.mark.parametrize("text", ["我想看一下我们全部照片。", "找点回忆看看"])
def test_unscoped_model_album_browse_is_not_rewritten_as_organizing(chat, monkeypatch, text):
    _, _, client, session, callback = chat
    callback.side_effect = None
    callback.return_value = dict(kind='tool', name='photo.album.list', arguments={})
    read = Mock(return_value=dict(photos=[], next_after_id=None))
    monkeypatch.setattr('src.apps.companion_runtime.photo_tools.read_photos', read)
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='album-no-scope', text=text, allow_external_text=True))
    assert result.status_code == 200, result.text
    assert result.json()['result']['kind'] == 'photo_read'
    callback.assert_called_once()
    assert read.call_args.args[1] == 'photo.album.list'
    assert read.call_args.args[2]['limit'] == 6


def test_album_search_phrase_is_registered_read_tool(chat, monkeypatch):
    store, _, client, session, callback = chat
    monkeypatch.setattr('src.apps.companion_runtime.photo_tools.read_photos', lambda *args: {'photos': [], 'next_after_id': None})
    response = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='album-search', text='搜索女儿在海边的照片', allow_external_text=True))
    assert response.status_code == 200
    assert response.json()['result']['name'] == 'photo.album.list'
    assert response.json()['result']['arguments']['query'] == '女儿在海边'
