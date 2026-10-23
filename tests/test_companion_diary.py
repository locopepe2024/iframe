from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.apps.companion_runtime.api import router, get_store
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.identity import UserContext, require_user_context


def test_diary_save_retry_revision_isolation_and_calendar(tmp_path):
    store=ChatStore(tmp_path/'diary.db',initialize=True)
    session=store.session('owner','session')['session_id']
    claim=store.claim_turn('owner','actor',session,'turn','整理日记')
    turn=store.finish_turn('owner','actor',claim,dict(kind='text',text='今天女儿来看我。'))
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_store]=lambda:store
    app.dependency_overrides[require_user_context]=lambda:UserContext('actor','owner','','')
    with TestClient(app) as client:
        base='/companion-runtime/diaries'
        body=dict(operation_id='save',text='今天女儿来看我。',source_turn_id=turn['turn_id'],expected_revision=0)
        assert client.get(base+'?month=2026-10').json()==dict(diaries=[])
        result=client.put(base+'/2026-10-23',json=body)
        assert result.status_code==200,result.text
        assert client.put(base+'/2026-10-23',json=body).json()==result.json()
        assert client.put(base+'/2026-10-23',json={**body,'text':'已修改'}).status_code==409
        assert client.put(base+'/2026-10-23',json={**body,'operation_id':'stale'}).status_code==409
        updated=client.put(base+'/2026-10-23',json={**body,'operation_id':'edit','expected_revision':1,'text':'今天女儿来看我，我们一起喝茶。'})
        assert updated.json()['revision']==2
        assert client.get(base+'?month=2026-10').json()['diaries']==[updated.json()]
        assert client.get(base+'?month=2026-11').json()['diaries']==[]
        assert client.get(base+'?month=2026-13').status_code==422
        assert client.put(base+'/2026-02-30',json=body).status_code==422
        assert client.put(base+'/2026-10-24',json={**body,'text':'   '}).status_code==422
        app.dependency_overrides[require_user_context]=lambda:UserContext('different','owner','','')
        assert client.get(base+'?month=2026-10').json()['diaries']==[]
        assert client.put(base+'/2026-10-23',json=body).status_code==404
        app.dependency_overrides[require_user_context]=lambda:UserContext('actor','other','','')
        assert client.get(base+'?month=2026-10').json()['diaries']==[]
        assert client.put(base+'/2026-10-23',json=body).status_code==404
    reopened=ChatStore(store.path)
    assert reopened.diaries('owner','actor','2026-10')['diaries'][0]['revision']==2
