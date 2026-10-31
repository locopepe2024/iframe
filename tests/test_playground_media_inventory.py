from types import SimpleNamespace
import json
from pathlib import Path
import sqlite3

from src.apps.playground.media_inventory import inventory


def storage(tmp_path, outputs=()):
    return SimpleNamespace(owner_profile_id='owner', media_root=str(tmp_path),
        output_dir=str(tmp_path / 'playground'), list_history=lambda **kwargs: outputs)


def test_inventory_does_not_create_stores_and_never_authorizes_deletion(tmp_path):
    s = storage(tmp_path, [SimpleNamespace(id='g', created_at='2026-01-01T00:00:00Z', outputs=[
        SimpleNamespace(id='o', saved_to_library=True)])])
    before = list(tmp_path.rglob('*'))
    report = inventory(s, now=2_000_000_000)
    assert list(tmp_path.rglob('*')) == before
    item = report['items'][0]
    assert item['archived'] is True
    assert item['proposed_expires_at'] is None  # request time is not completion time
    assert item['delete_eligible'] is False
    assert report['cleanup_enabled'] is False
    assert report['reference_scan_complete'] is False


def test_editor_copies_are_independent_and_expiry_is_only_proposed(tmp_path):
    s = storage(tmp_path)
    Path(s.output_dir).mkdir()
    path = Path(s.output_dir) / 'image-edits.sqlite3'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE edits(data TEXT, created REAL)')
        for index in (1, 2):
            db.execute('INSERT INTO edits VALUES(?,?)', (json.dumps(dict(id=str(index), path=f'/playground/input-media/{index}.png', source_reference='/playground/input-media/original.png')), index))
    before = path.read_bytes()
    report = inventory(s, limit=1, now=1_000_000)
    assert path.read_bytes() == before
    assert report['total'] == 2 and report['next_offset'] == 1
    assert report['items'][0]['id'] == 'edit:2'
    assert report['items'][0]['past_proposed_expiry']
    assert not report['items'][0]['delete_eligible']
    assert inventory(s, offset=1)['items'][0]['id'] == 'edit:1'


def test_damaged_store_reports_incomplete_inventory(tmp_path):
    s = storage(tmp_path)
    Path(s.output_dir).mkdir()
    (Path(s.output_dir) / 'image-edits.sqlite3').write_bytes(b'broken')
    report = inventory(s)
    assert report['diagnostics'] == ['image_edits_unreadable']
    assert report['cleanup_enabled'] is False


def test_owner_inventory_does_not_migrate_legacy_history_or_expose_other_owner(tmp_path):
    import hashlib
    from src.apps.playground.media_inventory import owner_inventory
    owner = SimpleNamespace(user_id='user', owner_profile_id='owner')
    root = tmp_path / 'users' / hashlib.sha256(b'owner').hexdigest()[:24]
    root.mkdir(parents=True)
    path = root / 'playground_history.json'
    legacy = dict(id='legacy', mode='t2i', model_id='model', prompt='p', created_at='2026-01-01T00:00:00Z',
        outputs=[dict(id='out', media_path='legacy.png', media_type='image')])
    foreign = dict(legacy, id='foreign', owner_profile_id='someone-else')
    path.write_text(json.dumps([legacy, foreign]))
    before = {str(p): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    report = owner_inventory(owner, tmp_path)
    assert report['total'] == 1
    assert report['diagnostics'] == ['history_owner_mismatch']
    assert {str(p): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()} == before
    assert not (root / 'playground_sessions.json').exists()


def test_invalid_dates_are_not_cleanup_candidates():
    from src.apps.playground.media_inventory import timestamp
    assert timestamp('bad') is None
    assert timestamp(float('nan')) is None
    assert timestamp('2026-01-01T08:00:00+08:00') == timestamp('2026-01-01T00:00:00Z')


def test_inventory_api_is_scoped_to_authenticated_profile(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.playground import api
    from src.apps.identity import UserContext, require_user_context
    from src.apps.media_registry import register_media
    owner = UserContext('user-a', 'profile-a', 'A', '')
    other = UserContext('user-b', 'profile-b', 'B', '')
    register_media('profile-a', 'users/a/input.png', kind='temporary_input', output_root=str(tmp_path))
    monkeypatch.setattr(api, 'media_root', lambda: str(tmp_path))
    monkeypatch.setattr(api, '_storage_for', lambda _: (_ for _ in ()).throw(AssertionError('Inventory must not initialize or migrate storage')))
    app = FastAPI()
    app.include_router(api.router, prefix='/playground')
    app.dependency_overrides[require_user_context] = lambda: owner
    client = TestClient(app)
    response = client.get('/playground/media-inventory')
    assert response.status_code == 200
    assert response.json()['total'] == 1
    assert response.json()['items'][0]['reference'] is None
    assert client.get('/playground/media-inventory?limit=101').status_code == 422
    app.dependency_overrides[require_user_context] = lambda: other
    assert client.get('/playground/media-inventory').json()['total'] == 0
