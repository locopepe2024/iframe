from unittest.mock import Mock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from src.apps.companion_runtime.api import router, get_store
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime import media_routes as services
from src.apps.identity import UserContext, require_user_context

@pytest.fixture
def client(tmp_path, monkeypatch):
    store=ChatStore(tmp_path/'companion.db',initialize=True)
    monkeypatch.setenv('IFRAME_COMPANION_DB_PATH',str(store.path))
    app=FastAPI();app.include_router(router)
    app.dependency_overrides[get_store]=lambda:store
    app.dependency_overrides[require_user_context]=lambda:UserContext('user','owner','','')
    with TestClient(app) as c:yield c,store,app


def test_channel_secret_is_encrypted_and_never_returned(client):
    c,store,_=client
    response=c.put('/companion-runtime/channel',json=dict(api_key='private-test-secret',base_url='https://example.test/v1'))
    assert response.status_code==200,response.text
    assert response.json()['configured'] is True
    assert 'private-test-secret' not in response.text
    with store.connection() as db:
        row=db.execute('SELECT secrets_json FROM user_configs').fetchone()[0]
        assert 'private-test-secret' not in row
    assert c.put('/companion-runtime/channel',json=dict(api_key=None,base_url='http://example.test')).status_code==422


def test_generation_receipt_idempotency_owner_and_explicit_permission(client,monkeypatch):
    c,store,app=client
    monkeypatch.setattr(services.channel,'runtime',lambda _:dict(base_url='https://example.test/v1',api_key='secret'))
    monkeypatch.setattr(services,'fetch_uniart_catalog',lambda _: [dict(id='uniart/gpt-image-2',capabilities=['t2i'])])
    def execute(store,identity,job_id,body,config,options):
        with store.connection(write=True) as db: db.execute("UPDATE companion_generations SET status='completed' WHERE id=?",(job_id,))
    callback=Mock(side_effect=execute);monkeypatch.setattr(services,'execute',callback)
    body=dict(operation_id='test',mode='image',model='uniart/gpt-image-2',prompt='一朵花',setting='方形 1:1',allow_external_generation=True)
    assert c.post('/companion-runtime/generations',json={**body,'allow_external_generation':False}).status_code==422
    first=c.post('/companion-runtime/generations',json=body);assert first.status_code==200,first.text
    again=c.post('/companion-runtime/generations',json=body)
    assert again.json()['id']==first.json()['id'];assert callback.call_count==1
    assert c.post('/companion-runtime/generations',json={**body,'prompt':'changed'}).status_code==409
    app.dependency_overrides[require_user_context]=lambda:UserContext('other','other','','')
    assert c.get('/companion-runtime/generations/'+first.json()['id']).status_code==404


def test_speech_contract_and_binary_validation(client,monkeypatch):
    c,_,_=client
    monkeypatch.setattr(services.channel,'runtime',lambda _:dict(base_url='https://example.test/v1',api_key='secret'))
    response=Mock();response.iter_content.return_value=[b'RIFF1234WAVEdata'];response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
    post=Mock(return_value=response);monkeypatch.setattr(services.requests,'post',post)
    result=c.post('/companion-runtime/speech',json=dict(text='你好',allow_external_text=True))
    assert result.status_code==200 and result.content==b'RIFF1234WAVEdata'
    assert post.call_args.kwargs['json']['model']=='qwen-audio-3.0-tts-flash'
    assert post.call_args.kwargs['json']['voice']=='longanhuan_v3.6'
    result=c.post('/companion-runtime/speech',json=dict(text='你好',voice='longanyang_v3.6',allow_external_text=True))
    assert result.status_code==200
    assert post.call_args.kwargs['json']['voice']=='longanyang_v3.6'
    response.iter_content.return_value=[b'{"error":"private"}']
    assert c.post('/companion-runtime/speech',json=dict(text='你好',allow_external_text=True)).status_code==502


def test_video_uses_shared_adapter_defaults_and_rejects_unsupported_duration(client, monkeypatch):
    from src.models.uniart import UniArtVideoModel
    from pathlib import Path
    c,_,_=client
    monkeypatch.setattr(services.channel,'runtime',lambda _:dict(base_url='https://example.test/v1',api_key='secret'))
    monkeypatch.setattr(services,'fetch_uniart_catalog',lambda _: [dict(id='uniart/minimax-h3',capabilities=['t2v'],duration=dict(min=4,max=8),params=dict(resolution=dict(default='720p')))])
    def output(self,prompt,path,**kwargs):
        assert prompt=='一朵花'
        assert kwargs==dict(model_name='uniart/minimax-h3',duration=5,resolution='720p',generate_audio=False)
        Path(path).write_bytes(b'mocked-video')
    monkeypatch.setattr(UniArtVideoModel,'generate',output)
    body=dict(operation_id='video',mode='video',model='uniart/minimax-h3',prompt='一朵花',setting='10 秒',allow_external_generation=True)
    assert c.post('/companion-runtime/generations',json=body).status_code==422
    result=c.post('/companion-runtime/generations',json={**body,'setting':'5 秒'})
    assert result.status_code==200,result.text
    prefix='/companion-runtime/generations/'+result.json()['id']
    assert c.get(prefix).json()['status']=='completed'
    assert c.get(prefix+'/media').content==b'mocked-video'
