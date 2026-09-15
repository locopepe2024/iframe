from pathlib import Path
from src.apps.playground import api
from src.apps.playground.models import PlaygroundGeneration, PlaygroundOutput, PlaygroundDraft
from src.apps.playground.storage import PlaygroundStorage
from src.apps.identity import UserContext


def test_session_and_history_refresh_owned_reference_previews(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    identity = UserContext(user_id='user', owner_profile_id='profile', display_name='', access_token='')
    storage = PlaygroundStorage(owner_user_id='user', owner_profile_id='profile')
    monkeypatch.setattr(api, '_storage_for', lambda _: storage)
    media = Path(storage.output_dir) / 'images' / 'original.png'
    media.parent.mkdir(parents=True)
    media.write_bytes(b'image')
    generation = PlaygroundGeneration(id='g', mode='t2i', model_id='test', prompt='test', created_at='2026-09-15',
        owner_user_id='user', owner_profile_id='profile',
        outputs=[PlaygroundOutput(id='o', media_path=str(media), media_type='image')])
    storage.add_generation(generation)
    old_url = '/playground/media/g/o?expires=1&signature=expired'
    session = storage.create_session('test')
    session.draft = PlaygroundDraft(input_media=[old_url, str(media)], media_names={'/playground/media/g/o': 'Portrait', str(media): 'Portrait'})
    payload = api.get_session(session.id, identity)
    assert payload['draft']['input_media'][0] == payload['draft']['input_media'][1]
    assert 'signature=expired' not in payload['draft']['input_media'][0]
    assert payload['draft']['input_media'][0].startswith('/playground/media/g/o?')
    assert session.draft.input_media[0] == old_url
    generation.input_media = [str(media)]
    assert api._public_generation(generation, identity)['input_media'][0].startswith('/playground/media/g/o?')


def test_legacy_upload_preview_is_owner_scoped(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    owner = PlaygroundStorage(owner_user_id='a', owner_profile_id='a')
    other = PlaygroundStorage(owner_user_id='b', owner_profile_id='b')
    upload = Path(owner.output_dir) / 'uploads' / 'portrait.png'
    upload.parent.mkdir(parents=True)
    upload.write_bytes(b'image')
    assert owner.browser_media_reference(str(upload)) == '/playground/input-media/portrait.png'
    assert other.browser_media_reference(str(upload)) == str(upload)


def test_generation_status_is_complete_and_caps_large_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('LUMENX_MEDIA_SIGNING_KEY', 'test-key')
    identity = UserContext(user_id='user', owner_profile_id='profile', display_name='', access_token='')
    storage = PlaygroundStorage(owner_user_id='user', owner_profile_id='profile')
    monkeypatch.setattr(api, '_storage_for', lambda _: storage)
    generation = PlaygroundGeneration(id='g', mode='t2i', model_id='test', prompt='test', created_at='2026-09-15',
        owner_user_id='user', owner_profile_id='profile', status='failed', error='x' * 10_000)
    storage.add_generation(generation)
    payload = api.get_generation_status('g', identity)
    assert payload['mode'] == 't2i'
    assert payload['prompt'] == 'test'
    assert len(payload['error']) == 2003
