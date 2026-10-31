"""Independent edits preserve immutable owner media and source projects."""
import io
import json
import subprocess
import pytest
from fastapi import HTTPException
from src.apps.identity import UserContext
from src.apps.editing.service import EditingService
from src.apps.comic_gen.models import AssemblyEditPlan
from src.apps.recreation.service import RecreationService

@pytest.fixture
def service(tmp_path):
    return EditingService(UserContext('user', 'profile', 'User', ''), output_root=tmp_path)

@pytest.fixture
def video(tmp_path):
    path = tmp_path / 'input.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=96x64:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(path)], check=True)
    return path


def material(service, video):
    with video.open('rb') as stream:
        return service.upload(stream, 'clip.mp4')


def plan_for(item):
    return AssemblyEditPlan.model_validate(dict(scope='project', target_duration_ms=1000, lanes=[dict(id='video', kind='video', clips=[dict(id='clip', timeline_start_ms=0, timeline_end_ms=1000, source_media_id=item['id'], source_refs=['media:'+item['id']])])]))


def test_save_restore_and_owner_boundary(service, video):
    item = material(service, video)
    project = service.create('Independent')
    saved = service.save(project['id'], 0, plan_for(item))
    reopened = service.get(project['id'])
    assert reopened['plan'] == saved['plan']
    assert reopened['sources'][item['id']]['sha256'] == item['sha256']
    assert service.materials()['items'][0]['id'] == item['id']
    with pytest.raises(HTTPException) as error:
        service.save(project['id'], 0, plan_for(item))
    assert error.value.status_code == 409
    restored = service.restore(project['id'], 1, 1)
    assert restored['revision'] == 2
    assert [v['revision'] for v in service.versions(project['id'])] == [2, 1, 0]
    stranger = EditingService(UserContext('other', 'other', 'Other', ''), output_root=service.output_root)
    for operation in (lambda: stranger.get(project['id']), lambda: stranger.resolve(item['id']), lambda: stranger.versions(project['id'])):
        with pytest.raises(HTTPException) as error:
            operation()
            assert error.value.status_code == 404


def test_project_workspace_and_soft_delete_preserve_sources(service, video):
    item = material(service, video)
    project = service.create('Workspace')
    workspace = service.output_root / project['workspace']
    assert (workspace / 'tmp').is_dir()
    assert (workspace / 'outputs').is_dir()
    service.save(project['id'], 0, plan_for(item))
    deleted = service.delete(project['id'])
    assert deleted == {'id': project['id'], 'deleted': True}
    assert service.list() == []
    for operation in (
        lambda: service.get(project['id']),
        lambda: service.versions(project['id']),
        lambda: service.render(project['id'], 1),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 404
    assert service.resolve(item['id'])[0]['sha256'] == item['sha256']


def test_source_mutation_and_invalid_range_rejected(service, video):
    item = material(service, video)
    project = service.create('Independent')
    plan = plan_for(item)
    plan.lanes[0].clips[0].source_start_ms = 500
    with pytest.raises(HTTPException) as error:
        service.save(project['id'], 0, plan)
    assert error.value.status_code == 422
    plan = plan_for(item)
    plan.lanes[0].clips[0].source_project_id = 'original'
    with pytest.raises(HTTPException) as error:
        service.save(project['id'], 0, plan)
    assert error.value.status_code == 422
    service.save(project['id'], 0, plan_for(item))
    _, path = service.resolve(item['id'])
    with open(path, 'ab') as stream:
        stream.write(b'changed')
    with pytest.raises(HTTPException) as error:
        service.render(project['id'], 1)
    assert error.value.status_code == 409


def test_import_and_render_leave_recreation_unchanged(service, video):
    recreation = RecreationService(service.user, output_root=str(service.output_root))
    with video.open('rb') as stream:
        original = recreation.register(stream, 'original.mp4')
    source_id = 'recreation:' + original['source_media_id']
    item, path = service.resolve(source_id)
    original_bytes = open(path, 'rb').read()
    plan = plan_for(item)
    # Repeat the immutable reference as a second clip.
    second = plan.lanes[0].clips[0].model_copy(update={'id': 'second', 'timeline_start_ms': 1000, 'timeline_end_ms': 2000})
    plan.lanes[0].clips.append(second)
    plan.target_duration_ms = 2000
    project = service.create('Two clips')
    saved = service.save(project['id'], 0, plan)
    output = service.render(project['id'], saved['revision'])
    result = service.output_root / output['output']['url']
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', str(result)]))
    assert abs(float(probe['format']['duration']) - 2) < .15
    assert {s['codec_type'] for s in probe['streams']} == {'video', 'audio'}
    assert recreation.get(original['id']) == original
    assert open(path, 'rb').read() == original_bytes
    assert any(i['origin'] == 'generated' and i['name'] == 'Two clips.mp4' for i in service.materials()['items'])


def test_invalid_upload_is_not_registered(service):
    with pytest.raises((subprocess.CalledProcessError, HTTPException)):
        service.upload(io.BytesIO(b'not a video'), 'fake.mp4')
    assert service.materials()['items'] == []
    assert not list(service.root.glob('*.mp4'))


def test_audio_captions_and_stale_render(service, video, tmp_path, monkeypatch):
    from src.apps.editing import service as module
    from src.apps.comic_gen.models import AssemblyLane
    from src.apps.comic_gen.assembly_subtitles import export_srt
    item = material(service, video)
    audio_file = tmp_path / 'tone.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5', str(audio_file)], check=True)
    with audio_file.open('rb') as stream:
        sound = service.upload(stream, 'sound.wav')
    plan = plan_for(item)
    plan.lanes.extend([
        AssemblyLane.model_validate(dict(id='music', kind='bgm', clips=[dict(id='sound', source_media_id=sound['id'], source_refs=['media:'+sound['id']], timeline_start_ms=250, timeline_end_ms=750)])),
        AssemblyLane.model_validate(dict(id='captions', kind='subtitle', clips=[dict(id='caption', timeline_start_ms=100, timeline_end_ms=900, text='A caption')]))])
    project = service.create('Audio edit')
    saved = service.save(project['id'], 0, plan)
    output = service.render(project['id'], 1)
    assert output['output']['revision'] == 1
    assert '00:00:00,100 --> 00:00:00,900' in export_srt(AssemblyEditPlan.model_validate(saved['plan']), 'captions')
    original_compiler = module.compile_assembly
    def racing_compiler(*args):
        original_compiler(*args)
        service.save(project['id'], 1, plan)
    monkeypatch.setattr(module, 'compile_assembly', racing_compiler)
    before_files = set(service.root.glob('*.mp4'))
    with pytest.raises(HTTPException) as error:
        service.render(project['id'], 1)
    assert error.value.status_code == 409
    assert service.get(project['id'])['output'] is None
    assert set(service.root.glob('*.mp4')) == before_files


def test_api_requires_owner_and_exports_saved_subtitles(service, video, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.editing import api
    from src.apps.studio_access import require_studio_user
    monkeypatch.setattr(api, 'EditingService', lambda user: service)
    monkeypatch.setattr(api, 'public', lambda value, user: value)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    assert client.get('/editing/projects').status_code == 401
    app.dependency_overrides[require_studio_user] = lambda: service.user
    created = client.post('/editing/projects', json={'title': 'API edit'}).json()
    item = material(service, video)
    plan = plan_for(item)
    response = client.put(f"/editing/projects/{created['id']}/plan", json={'revision': 0, 'plan': plan.model_dump()})
    assert response.status_code == 200
    assert client.put(f"/editing/projects/{created['id']}/plan", json={'revision': 0, 'plan': plan.model_dump()}).status_code == 409
    assert client.get('/editing/materials', params={'cursor': -1}).status_code == 422
    assert client.get(f"/editing/projects/{created['id']}/subtitles/absent").status_code == 422


def test_material_folders_move_rename_delete_and_owner_boundary(service, video):
    folder = service.create_folder('Rushes')
    other = service.create_folder('Music')
    with video.open('rb') as stream:
        item = service.upload(stream, 'rush.mp4', folder['id'])
    assert service.materials_page(folder_id=folder['id'])['items'][0]['id'] == item['id']
    assert service.materials_page(folder_id='__none')['items'] == []
    service.rename_folder(folder['id'], 'Camera A')
    assert service.materials()['items'][0]['folder_name'] == 'Camera A'
    with pytest.raises(HTTPException) as error:
        service.delete_folder(folder['id'])
    assert error.value.status_code == 409
    stranger = EditingService(UserContext('other', 'other', 'Other', ''), output_root=service.output_root)
    for operation in (
        lambda: stranger.rename_folder(folder['id'], 'Stolen'),
        lambda: stranger.delete_folder(folder['id']),
        lambda: stranger.assign_folder(item['id'], other['id']),
        lambda: stranger.delete_material(item['id']),
        lambda: service.upload(io.BytesIO(b'not used'), 'rush.mp4', stranger.create_folder('Private')['id']),
    ):
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 404
    service.assign_folder(item['id'], other['id'])
    assert service.materials_page(folder_id=folder['id'])['items'] == []
    service.delete_folder(folder['id'])
    service.assign_folder(item['id'], None)
    assert service.materials_page(folder_id='__none')['items'][0]['id'] == item['id']
    service.delete_material(item['id'])
    assert service.materials()['items'] == []
    with pytest.raises(HTTPException) as error:
        service.resolve(item['id'])
    assert error.value.status_code == 404


def test_delete_protects_historical_versions_and_shared_registry(service, video):
    from src.apps.media_registry import get_media, register_media
    old = material(service, video)
    new = material(service, video)
    edit = service.create('History')
    service.save(edit['id'], 0, plan_for(old))
    service.save(edit['id'], 1, plan_for(new))
    with pytest.raises(HTTPException) as error:
        service.delete_material(old['id'])
    assert error.value.status_code == 409
    assert service.restore(edit['id'], 2, 1)['sources'][old['id']]
    temporary = material(service, video)
    service.delete_material(temporary['id'])
    # Other products may still reference this immutable registry mapping.
    retained = get_media(service.user.owner_profile_id, temporary['id'].split(':')[1], output_root=str(service.output_root))
    assert (service.output_root / retained['storage_key']).is_file()
    with pytest.raises(HTTPException) as error:
        service.save(edit['id'], 3, plan_for(temporary))
    assert error.value.status_code == 404
    generated = register_media(service.user.owner_profile_id, 'users/generated.mp4', kind='editing_output', output_root=str(service.output_root))
    with pytest.raises(HTTPException) as error:
        service.delete_material('core:' + generated)
    assert error.value.status_code == 404


def test_folder_api_routes(service, video, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.editing import api
    from src.apps.studio_access import require_studio_user
    monkeypatch.setattr(api, 'EditingService', lambda user: service)
    monkeypatch.setattr(api, 'public', lambda value, user: value)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    assert client.get('/editing/folders').status_code == 401
    app.dependency_overrides[require_studio_user] = lambda: service.user
    folder = client.post('/editing/folders', json={'name': 'Folder'}).json()
    assert client.patch('/editing/folders/'+folder['id'], json={'name': 'Renamed'}).status_code == 200
    with video.open('rb') as stream:
        uploaded = client.post('/editing/materials', params={'folder_id': folder['id']}, files={'file': ('test.mp4', stream, 'video/mp4')})
    assert uploaded.status_code == 201
    key = uploaded.json()['id']
    assert len(client.get('/editing/materials', params={'folder_id': folder['id']}).json()['items']) == 1
    assert client.delete('/editing/folders/'+folder['id']).status_code == 409
    assert client.patch('/editing/materials/'+key, json={'folder_id': None}).status_code == 200
    assert client.delete('/editing/materials/'+key).status_code == 200
    assert client.delete('/editing/folders/'+folder['id']).status_code == 200


def test_material_cards_include_verified_streams_and_duration(service, video):
    item = material(service, video)
    card = service.materials()['items'][0]
    assert card['id'] == item['id']
    assert card['video'] is True and card['audio'] is True
    assert card['duration_ms'] == 1000
    legacy = service._card_media(dict(storage_key='old.mp4', metadata={}))
    assert legacy['video'] is True and legacy['duration_ms'] == 0
