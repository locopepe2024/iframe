from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from src.apps.companion_runtime.api import router
from src.apps.companion_runtime.store import CompanionStore, Conflict, Missing
from src.apps.companion_runtime.tools import dispatch
from src.apps.identity import UserContext, require_user_context


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    now=[1000.]
    store=CompanionStore(tmp_path/'companion.db',initialize=True,clock=lambda:now[0])
    monkeypatch.setenv('IFRAME_COMPANION_DB_PATH',str(store.path))
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[require_user_context]=lambda:UserContext('actor','owner','','')
    # Share test clock with HTTP dependency.
    from src.apps.companion_runtime.api import get_store
    app.dependency_overrides[get_store]=lambda:store
    with TestClient(app) as client:
        yield store,now,app,client


def source(store, text='我喜欢散步，也喜欢看老照片。'):
    session=store.session('owner','session')['session_id']
    return store.message('owner',session,'message',text)


def draft(message, content='喜欢散步', **extra):
    return dict(source_message_id=message['id'],quote='喜欢散步',content=content,type='preference',importance=3,**extra)


def save(store, message, operation='save', **changes):
    values={**draft(message),**changes}
    plan=dispatch(store,'owner','actor','memory.save',values)
    return store.confirm('owner','actor',plan['preview_token'],operation)


def test_explicit_initialization_message_idempotency_and_paged_history(runtime,tmp_path):
    store,_,_,_=runtime
    with pytest.raises(sqlite3.OperationalError):
        CompanionStore(tmp_path/'missing.db').session('owner','op')
    with pytest.raises(ValueError):CompanionStore('relative.db')
    message=source(store)
    assert source(store)==message
    with pytest.raises(Conflict):source(store,'另一条消息')
    for i in range(105):store.message('owner',message['session_id'],str(i),f'用户原话{i}')
    seen=[];after=0
    while True:
        page=store.messages('owner',message['session_id'],after=after,limit=17)
        seen.extend(m['id'] for m in page['messages'])
        if page['next_after'] is None:break
        after=page['next_after']
    assert len(seen)==106 and len(set(seen))==106
    with pytest.raises(Missing):store.messages('other',message['session_id'])


def test_four_tool_schemas_proposal_cancel_confirmation_http(runtime):
    store,_,_,client=runtime
    base='/companion-runtime'
    schemas=client.get(base+'/tools').json()['tools']
    assert {t['name'] for t in schemas}=={'memory.save','memory.search','memory.list','memory.delete','photo.album.list','photo.item.read','photo.organize.start'}
    session=client.post(base+'/sessions',json=dict(operation_id='s')).json()['session_id']
    msg=client.post(base+f'/sessions/{session}/messages',json=dict(operation_id='m',text='我喜欢散步')).json()
    assert client.post(base+f'/sessions/{session}/messages',json=dict(operation_id='f',text='假来源',role='assistant')).status_code==422
    values=draft(msg)
    prepared=client.post(base+'/tools',json=dict(name='memory.save',arguments=values)).json()
    assert prepared['status']=='pending_confirmation'
    assert prepared['preview']['source_text']=='我喜欢散步'
    assert store.memories('owner')['memories']==[]
    assert client.post(base+'/cancel',json=dict(preview_token=prepared['preview_token'])).status_code==200
    request=dict(operation_id='confirm',preview_token=prepared['preview_token'],method='button')
    assert client.post(base+'/confirmations',json=request).status_code==404
    prepared=client.post(base+'/tools',json=dict(name='memory.save',arguments=values)).json()
    request['preview_token']=prepared['preview_token']
    assert client.post(base+'/confirmations',json={**request,'method':'voice_confirmed'}).status_code==422
    confirmed=client.post(base+'/confirmations',json=request)
    assert confirmed.status_code==200
    assert client.post(base+'/confirmations',json=request).json()==confirmed.json()
    assert client.post(base+'/confirmations',json={**request,'preview_token':'a'*64}).status_code==409
    identity=confirmed.json()['memory_id']
    assert client.get(base+'/memories/'+identity).json()['source_message_id']==msg['id']
    assert client.get(base+f'/sessions/{session}/messages').json()['messages'][0]['id']==msg['id']


def test_search_relevance_types_literal_characters_and_more_than100_paging(runtime):
    store,_,_,_=runtime
    msg=source(store)
    for i in range(105):save(store,msg,str(i),content=f'散步{i}',importance=i%5+1)
    special=save(store,msg,'special',content='只匹配100%_\\原文',type='personal_fact',importance=5)
    save(store,msg,'irrelevant',content='无关的高重要度内容',quote='老照片',importance=5)
    matches=store.memories('owner',query='散步',limit=100)
    assert len(matches['memories'])==100 and matches['next_cursor']
    tail=store.memories('owner',query='散步',cursor=matches['next_cursor'],limit=100)
    assert len(tail['memories'])==6  # special content retains source quote 喜欢散步
    ids=[m['id'] for m in matches['memories']+tail['memories']]
    assert len(ids)==len(set(ids))==106
    assert [m['importance'] for m in matches['memories']]==sorted([m['importance'] for m in matches['memories']],reverse=True)
    assert store.memories('owner',query='完全没有')['memories']==[]
    assert store.memories('owner',query='%_\\')['memories'][0]['id']==special['memory_id']
    assert len(store.memories('owner',type='personal_fact')['memories'])==1
    assert all(m['importance']>=4 for m in store.memories('owner',min_importance=4)['memories'])
    with pytest.raises(ValueError):store.memories('owner',query='别的',cursor=matches['next_cursor'])
    with pytest.raises(ValueError):store.memories('owner',query=' ')
    with pytest.raises(ValueError):store.memories('owner',cursor='[]')
    first=store.memories('owner',limit=100)
    second=store.memories('owner',cursor=first['next_cursor'],limit=100)
    assert len(first['memories'])+len(second['memories'])==107
    assert store.memories('other')['memories']==[]


def test_source_owner_actor_and_unknown_tools_cannot_spoof(runtime):
    store,_,app,client=runtime
    msg=source(store)
    with pytest.raises(ValueError):dispatch(store,'owner','actor','memory.save',{**draft(msg),'quote':'模型虚构'})
    with pytest.raises(Missing):dispatch(store,'other','actor','memory.save',draft(msg))
    for name,args in [('memory.confirm',{}),('memory.save',{**draft(msg),'owner':'other'}),('memory.delete',dict(memory_id='fake',method='button'))]:
        assert client.post('/companion-runtime/tools',json=dict(name=name,arguments=args)).status_code==422
    plan=dispatch(store,'owner','actor','memory.save',draft(msg))
    with pytest.raises(Missing):store.confirm('owner','different',plan['preview_token'],'op')
    with pytest.raises(Missing):store.confirm('other','actor',plan['preview_token'],'op')
    result=store.confirm('owner','actor',plan['preview_token'],'op')
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert client.get('/companion-runtime/memories/'+result['memory_id']).status_code==404
    assert client.get('/companion-runtime/sessions/'+msg['session_id']+'/messages').status_code==404


def test_expiry_concurrent_confirmation_and_transaction_rollback(runtime):
    store,now,_,_=runtime
    msg=source(store)
    expired=dispatch(store,'owner','actor','memory.save',draft(msg))
    now[0]+=901
    with pytest.raises(Conflict):store.confirm('owner','actor',expired['preview_token'],'expired')
    plan=dispatch(store,'owner','actor','memory.save',draft(msg))
    with store.connection(write=True) as db:
        assert db.execute('SELECT COUNT(*) FROM companion_memory_previews WHERE token=?',(expired['preview_token'],)).fetchone()[0]==0
        db.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON companion_memory_receipts BEGIN SELECT RAISE(ABORT,'test'); END")
    with pytest.raises(sqlite3.IntegrityError):store.confirm('owner','actor',plan['preview_token'],'concurrent')
    assert store.memories('owner')['memories']==[]
    with store.connection(write=True) as db:db.execute('DROP TRIGGER fail_receipt')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:store.confirm('owner','actor',plan['preview_token'],'concurrent'),range(2)))
    assert results[0]==results[1]
    assert len(store.memories('owner')['memories'])==1


def test_delete_confirmation_cancel_and_receipts_do_not_keep_text(runtime):
    store,_,_,_=runtime
    msg=source(store)
    saved=save(store,msg)
    identity=saved['memory_id']
    first=dispatch(store,'owner','actor','memory.delete',dict(memory_id=identity))
    assert first['preview']['memory']['content']=='喜欢散步'
    assert store.memory('owner',identity)
    store.cancel('owner','actor',first['preview_token'])
    assert store.memory('owner',identity)
    plans=[dispatch(store,'owner','actor','memory.delete',dict(memory_id=identity)) for _ in range(2)]
    receipt=store.confirm('owner','actor',plans[0]['preview_token'],'delete')
    assert store.confirm('owner','actor',plans[0]['preview_token'],'delete')==receipt
    with pytest.raises(Missing):store.memory('owner',identity)
    assert store.memories('owner',query='散步')['memories']==[]
    assert store.memories('owner')['memories']==[]
    with pytest.raises(Missing):store.confirm('owner','actor',plans[1]['preview_token'],'stale')
    with store.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM companion_memory_previews').fetchone()[0]==0
        receipts=[dict(row) for row in db.execute('SELECT * FROM companion_memory_receipts')]
    assert '喜欢散步' not in json.dumps(receipts,ensure_ascii=False)
    # Deleting a saved memory does not claim to erase its original chat message.
    assert store.messages('owner',msg['session_id'])['messages'][0]['text']==msg['text']


def test_delete_rollback_stale_parallel_previews_and_save_receipt_no_resurrection(runtime):
    store,_,_,_=runtime
    msg=source(store)
    save_plan=dispatch(store,'owner','actor','memory.save',draft(msg))
    saved=store.confirm('owner','actor',save_plan['preview_token'],'save')
    plans=[dispatch(store,'owner','actor','memory.delete',dict(memory_id=saved['memory_id'])) for _ in range(2)]
    with store.connection(write=True) as db:
        db.execute("CREATE TRIGGER fail_delete_receipt BEFORE INSERT ON companion_memory_receipts WHEN NEW.action='delete' BEGIN SELECT RAISE(ABORT,'test'); END")
    with pytest.raises(sqlite3.IntegrityError):store.confirm('owner','actor',plans[0]['preview_token'],'delete')
    assert store.memory('owner',saved['memory_id'])
    with store.connection(write=True) as db:db.execute('DROP TRIGGER fail_delete_receipt')
    def attempt(index):
        try:
            store.confirm('owner','actor',plans[index]['preview_token'],f'delete-{index}')
            return 'deleted'
        except Missing:return 'stale'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt,range(2)))==['deleted','stale']
    assert store.confirm('owner','actor',save_plan['preview_token'],'save')==saved
    assert store.memories('owner')['memories']==[]
    assert store.cancel('owner','actor',save_plan['preview_token'])['status']=='preview_closed'


def test_pending_capacity_and_input_bounds_without_silent_truncation(runtime):
    store,now,_,client=runtime
    msg=source(store)
    for _ in range(100):dispatch(store,'owner','actor','memory.save',draft(msg))
    with pytest.raises(Conflict):dispatch(store,'owner','actor','memory.save',draft(msg))
    assert store.memories('owner')['memories']==[]
    now[0]+=901
    assert dispatch(store,'owner','actor','memory.save',draft(msg))['status']=='pending_confirmation'
    for arguments in [dict(query=''),dict(query='x',limit=101),dict(query='x',min_importance=0),dict(query='x',type='enterprise')]:
        assert client.post('/companion-runtime/tools',json=dict(name='memory.search',arguments=arguments)).status_code==422
    assert client.post('/companion-runtime/sessions/'+msg['session_id']+'/messages',json=dict(operation_id='space',text=' ')).status_code==422
    for bad in ['null','{}','false','[1]']:
        with pytest.raises(ValueError):store.memories('owner',cursor=bad)
