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


def test_draft_generation_validates_revision_brief_and_reference_before_provider(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setattr(services.channel, 'runtime', lambda _: dict(base_url='https://example.test/v1', api_key='secret'))
    monkeypatch.setattr(services, 'fetch_uniart_catalog', lambda _: [dict(id='editor', capabilities=['i2i']), dict(id='text', capabilities=['t2i'])])
    executor = Mock()
    monkeypatch.setattr(services, 'execute', executor)
    media = Mock()
    media.media.return_value = (b'image-bytes', 'image/jpeg')
    monkeypatch.setattr(services, 'photo_store', lambda: media, raising=False)
    session = store.session('owner', 'draft-session')['session_id']
    task = store.start_media_draft('owner', 'user', session, 'start', dict(type='image_edit', brief='调亮，其他不变'))
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *a: {})
    task = store.update_media_draft('owner', 'user', session, task['task_id'], 'photo', dict(expected_revision=1, action='select_photo', photo_id='mine'))
    body = dict(operation_id='edit', mode='image', model='editor', prompt=task['brief'], setting='方形 1:1', reference='mine', task_id=task['task_id'], expected_revision=task['revision'], allow_external_generation=True)
    assert c.post('/companion-runtime/generations', json={**body, 'expected_revision':1}).status_code == 409
    assert c.post('/companion-runtime/generations', json={**body, 'prompt':'别的要求'}).status_code == 409
    assert c.post('/companion-runtime/generations', json={**body, 'model':'text'}).status_code == 422
    executor.assert_not_called()
    result = c.post('/companion-runtime/generations', json=body)
    assert result.status_code == 200, result.text
    media.media.assert_called_with('owner', 'mine', thumbnail=False)
    assert executor.call_args.args[-1]['_reference_media']['image'] == (b'image-bytes', 'image/jpeg')
    assert c.post('/companion-runtime/generations', json=body).json()['id'] == result.json()['id']
    assert executor.call_count == 1
    assert c.post('/companion-runtime/generations', json={**body, 'operation_id':'duplicate'}).status_code == 409
    restored = store.media_draft('owner', 'user', task['task_id'])
    assert restored['status'] == 'submitted' and restored['job_id'] == result.json()['id']
    from src.apps.companion_runtime.store import Conflict
    with pytest.raises(Conflict):
        store.update_media_draft('owner', 'user', session, task['task_id'], 'change', dict(expected_revision=restored['revision'], action='brief', brief='换背景'))


def test_reference_execution_uses_local_material_and_removes_it(client, monkeypatch):
    from pathlib import Path
    from src.models.uniart import UniArtImageModel, UniArtVideoModel
    c, store, _ = client
    session = store.session('owner', 'material-session')['session_id']
    identity = UserContext('user', 'owner', '', '')
    captured = []
    def output(self, prompt, path, **options):
        material = Path(options.get('ref_image_path') or options['img_path'])
        assert material.read_bytes() == b'photo-bytes'
        assert not str(material).startswith(('blob:', 'data:'))
        if 'img_path' in options:
            assert options['generate_audio'] is False
        captured.append(material)
        Path(path).write_bytes(b'result')
    monkeypatch.setattr(UniArtImageModel, 'generate', output)
    monkeypatch.setattr(UniArtVideoModel, 'generate', output)
    services.initialize(store)
    for mode in ('image', 'video'):
        body = services.Generate(operation_id=mode, mode=mode, model='model', prompt='保持其他不变', setting='方形 1:1' if mode == 'image' else '5 秒', allow_external_generation=True)
        with store.connection(write=True) as db:
            db.execute('INSERT INTO companion_generations VALUES (?,?,?,?,?,?,NULL)', (mode, 'owner', mode, 'digest', mode, 'running'))
        services.execute(store, identity, mode, body, {}, {'_reference_media':(b'photo-bytes','image/jpeg')})
        assert services.job(store, 'owner', mode)['status'] == 'completed'
        assert not captured[-1].exists()


def test_submission_requires_current_parameter_revision(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setattr(services.channel, 'runtime', lambda _: {})
    monkeypatch.setattr(services, 'fetch_uniart_catalog', lambda _: [dict(id='text', capabilities=['t2i'])])
    execute = Mock(); monkeypatch.setattr(services, 'execute', execute)
    session = store.session('owner', 'parameters')['session_id']
    task = store.start_media_draft('owner', 'user', session, 'new', dict(type='image_generate', brief='两只小狗'))
    changed = store.update_media_draft('owner', 'user', session, task['task_id'], 'ratio', dict(expected_revision=1, action='setting', setting='横向 16:9'))
    assert changed['revision'] == 2
    body = dict(operation_id='submit', mode='image', model='text', prompt='两只小狗', setting='方形 1:1', task_id=task['task_id'], expected_revision=2, allow_external_generation=True)
    assert c.post('/companion-runtime/generations', json=body).status_code == 409
    assert c.post('/companion-runtime/generations', json={**body,'setting':'横向 16:9'}).status_code == 200
    execute.assert_called_once()


def test_video_reference_modes_route_to_shared_h3_contract(client, monkeypatch):
    from pathlib import Path
    from src.models.uniart import UniArtVideoModel
    c, store, _ = client
    calls=[]
    def output(self, prompt, path, **kwargs):
        calls.append(kwargs)
        for key in ('img_path', 'first_frame', 'last_frame'):
            if key in kwargs: assert Path(kwargs[key]).read_bytes() in (b'first-bytes', b'last-bytes')
        for item in kwargs.get('ref_image_paths', []): assert Path(item).read_bytes() in (b'a-bytes', b'b-bytes')
        Path(path).write_bytes(b'video')
    monkeypatch.setattr(UniArtVideoModel, 'generate', output)
    identity = UserContext('user', 'owner', '', '')
    services.initialize(store)
    for index, mode_body in enumerate((
        dict(video_mode='i2v', first=(b'first-bytes', 'image/jpeg')),
        dict(video_mode='f2v', first=(b'first-bytes', 'image/jpeg'), last=(b'last-bytes', 'image/jpeg')),
        dict(video_mode='r2v', refs=[(b'a-bytes', 'image/jpeg'), (b'b-bytes', 'image/jpeg')]),
    )):
        job_id=f'mode-{index}'
        body = services.Generate(operation_id=job_id, mode='video', model='h3', prompt='让画面动起来', setting='5 秒', allow_external_generation=True, video_mode=mode_body['video_mode'])
        with store.connection(write=True) as db:
            db.execute('INSERT INTO companion_generations VALUES (?,?,?,?,?,?,NULL)', (job_id, 'owner', job_id, 'digest', 'video', 'running'))
        reference = {'first': mode_body.get('first'), 'last': mode_body.get('last'), 'refs': mode_body.get('refs', [])}
        services.execute(store, identity, job_id, body, {}, {'_reference_media': reference})
        assert services.job(store, 'owner', job_id)['status'] == 'completed'
    assert calls[0]['img_path']
    assert calls[1]['first_frame'] and calls[1]['last_frame']
    assert len(calls[2]['ref_image_paths']) == 2
    assert all(call['generate_audio'] is False for call in calls)


def test_completed_generation_can_be_saved_to_album_idempotently(client, monkeypatch, tmp_path):
    c, store, _ = client
    services.initialize(store)
    output = tmp_path / 'generated.png'; output.write_bytes(b'generated-image')
    with store.connection(write=True) as db:
        db.execute('INSERT INTO companion_generations VALUES (?,?,?,?,?,?,?)', ('save-job','owner','save-op','digest','image','completed',str(output)))
    photo_store = Mock(); photo_store.upload.return_value = {'photo_id':'saved-photo','created':True}
    monkeypatch.setattr(services, 'photo_store', lambda: photo_store)
    prepared = object()
    monkeypatch.setattr('src.apps.photos.media.prepare_photo', lambda raw: prepared)
    first = c.post('/companion-runtime/generations/save-job/save', json={'allow_save':True})
    assert first.status_code == 200 and first.json() == {'asset_type':'photo','photo_id':'saved-photo','created':True}
    photo_store.upload.assert_called_once_with('owner','generated-save-job',prepared)


def test_unified_photo_selected_event_uses_current_card_and_returns_next_step(client, monkeypatch):
    c, store, _ = client
    session = store.session('owner', 'unified-events')['session_id']
    task = store.start_media_draft('owner', 'user', session, 'start-event', {'type': 'image_edit'})
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    body = dict(operation_id='photo-event-1', event_type='photo_selected', task_id=task['task_id'],
                card_id=task['ui_card']['card_id'], photo_id='photo-owned', expected_revision=1)
    result = c.post(f'/companion-runtime/sessions/{session}/events', json=body)
    assert result.status_code == 200, result.text
    assert result.json()['status'] == 'accepted'
    assert result.json()['task']['revision'] == 2
    assert result.json()['next_step'] == 'awaiting_brief'
    assert c.post(f'/companion-runtime/sessions/{session}/events', json=body).json() == result.json()


def test_unified_photo_selected_event_rejects_old_card_and_wrong_session(client, monkeypatch):
    c, store, _ = client
    session = store.session('owner', 'unified-stale')['session_id']
    task = store.start_media_draft('owner', 'user', session, 'start-stale', {'type': 'image_edit'})
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    body = dict(operation_id='stale-event', event_type='photo_selected', task_id=task['task_id'],
                card_id='old:1:source', photo_id='photo-owned', expected_revision=1)
    assert c.post(f'/companion-runtime/sessions/{session}/events', json=body).status_code == 409
    other = store.session('owner', 'other-session')['session_id']
    body['operation_id'] = 'wrong-session'
    body['card_id'] = task['ui_card']['card_id']
    assert c.post(f'/companion-runtime/sessions/{other}/events', json=body).status_code == 404
