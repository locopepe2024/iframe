"""Real photo storage behind Agent tool and persisted chat results."""
import sqlite3

import pytest
from pydantic import ValidationError

from src.apps.photos.workflow import PhotoWorkflowStore
from src.apps.photos.dates import PhotoTimeEvidence
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Missing
from src.apps.companion_runtime.tools import dispatch


@pytest.fixture
def stores(tmp_path, monkeypatch):
    photos = PhotoWorkflowStore(tmp_path / 'photos.db')
    photos.register_photo('owner', 'batch', 'mine', PhotoTimeEvidence())
    photos.register_photo('other', 'batch', 'theirs', PhotoTimeEvidence())
    monkeypatch.setenv('IFRAME_PHOTOS_LOCAL_DB_PATH', str(photos.path))
    return ChatStore(tmp_path / 'chat.db', initialize=True), photos


def test_list_read_are_owner_scoped_and_do_not_write(stores):
    chat, photos = stores
    with sqlite3.connect(photos.path) as db:
        before = '\n'.join(db.iterdump())
    page = dispatch(chat, 'owner', 'actor', 'photo.album.list', {'view': 'pending'})
    assert [p['photo_id'] for p in page['photos']] == ['mine']
    item = dispatch(chat, 'owner', 'actor', 'photo.item.read', {'photo_id': 'mine'})['photos'][0]
    assert item['analysis'] is None and item['story'] is None and item['description'] is None
    with pytest.raises(Missing):
        dispatch(chat, 'owner', 'actor', 'photo.item.read', {'photo_id': 'theirs'})
    with sqlite3.connect(photos.path) as db:
        assert '\n'.join(db.iterdump()) == before


def test_query_pagination_and_strict_arguments(stores):
    chat, photos = stores
    photos.register_photo('owner', 'batch', 'next', PhotoTimeEvidence())
    first = dispatch(chat, 'owner', 'actor', 'photo.album.list', {'limit': 1})
    assert first['next_after_id'] == 'mine'
    second = dispatch(chat, 'owner', 'actor', 'photo.album.list', {'limit': 1, 'after_id': first['next_after_id']})
    assert [p['photo_id'] for p in second['photos']] == ['next']
    assert second['next_after_id'] is None
    assert dispatch(chat, 'owner', 'actor', 'photo.album.list', {'query': '女儿'})['photos'] == []
    for args in ({'owner': 'other'}, {'limit': 100}, {'year': '2026'}, {'view': 'unknown'}):
        with pytest.raises(ValidationError):
            dispatch(chat, 'owner', 'actor', 'photo.album.list', args)


def test_photo_turn_round_trip_and_history(stores):
    chat, _ = stores
    session = chat.session('owner', 's')['session_id']
    claim = chat.claim_turn('owner', 'actor', session, 't', '找出没有日期的照片')
    proposal = dict(kind='tool', name='photo.album.list', arguments={'view': 'pending'})
    turn = chat.finish_turn('owner', 'actor', claim, proposal)
    assert turn['result']['kind'] == 'photo_read'
    assert turn['result']['photos'][0]['photo_id'] == 'mine'
    assert chat.claim_turn('owner', 'actor', session, 't', '找出没有日期的照片')['cached']
    assert chat.turn('owner', 'actor', turn['turn_id']) == turn
    assert chat.conversation('owner', 'actor', session)['messages'][0]['turn'] == turn
    with pytest.raises(Missing):
        chat.turn('other', 'actor', turn['turn_id'])


def task_input(action, revision=1, operation='input', photo_id=None):
    return dict(operation_id=operation, expected_revision=revision, action=action, photo_id=photo_id)


def test_workflow_restart_idempotency_scope_and_cancel(stores):
    chat, _ = stores
    session = chat.session('owner', 's')['session_id']
    claim = chat.claim_turn('owner', 'actor', session, 'organize', '帮我整理没有日期的照片')
    result = chat.finish_turn('owner', 'actor', claim,
        dict(kind='tool', name='photo.organize.start', arguments={'view': 'pending'}))['result']
    assert result['step'] == 'select_photo' and result['status'] == 'waiting_input'
    task_id = result['task_id']
    restarted = ChatStore(chat.path)
    assert restarted.turn('owner', 'actor', claim['id'])['result'] == result
    for owner, actor in [('other', 'actor'), ('owner', 'another')]:
        with pytest.raises(Missing):
            restarted.photo_task(owner, actor, task_id)
        with pytest.raises(Missing):
            restarted.update_photo_task(owner, actor, task_id, task_input('cancel'))
    with pytest.raises(ValueError):
        restarted.update_photo_task('owner', 'actor', task_id, task_input('select', photo_id='theirs'))
    selected = restarted.update_photo_task('owner', 'actor', task_id, task_input('select', photo_id='mine'))
    assert selected['step'] == 'review_photo' and selected['revision'] == 2
    assert restarted.update_photo_task('owner', 'actor', task_id, task_input('select', photo_id='mine')) == selected
    from src.apps.companion_runtime.store import Conflict
    with pytest.raises(Conflict):
        restarted.update_photo_task('owner', 'actor', task_id, task_input('cancel'))
    with pytest.raises(Conflict):
        restarted.update_photo_task('owner', 'actor', task_id, task_input('cancel', operation='stale'))
    cancelled = restarted.update_photo_task('owner', 'actor', task_id, task_input('cancel', 2, 'cancel'))
    assert cancelled['status'] == 'cancelled' and cancelled['photos'] == []
    assert restarted.turn('owner', 'actor', claim['id'])['result'] == cancelled
    with pytest.raises(Conflict):
        restarted.update_photo_task('owner', 'actor', task_id, task_input('select', 3, 'late', 'mine'))


def test_close_task_does_not_claim_or_write_photo_metadata(stores):
    chat, photos = stores
    session = chat.session('owner', 's')['session_id']
    query = dict(view='pending', year=None, query='', after_id='', limit=6)
    with sqlite3.connect(photos.path) as db:
        before = '\n'.join(db.iterdump())
    task_id = chat.start_photo_task('owner', 'actor', session, 'workflow', query)
    assert chat.start_photo_task('owner', 'actor', session, 'workflow', query) == task_id
    closed = chat.update_photo_task('owner', 'actor', task_id, task_input('close'))
    assert closed['status'] == 'completed' and closed['step'] == 'closed'
    with sqlite3.connect(photos.path) as db:
        assert '\n'.join(db.iterdump()) == before


def test_task_http_identity_and_revision_contract(stores):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.companion_runtime.api import router, get_store
    from src.apps.identity import UserContext, require_user_context
    chat, _ = stores
    session = chat.session('owner', 's')['session_id']
    task_id = chat.start_photo_task('owner', 'actor', session, 'op',
        dict(view='pending', year=None, query='', after_id='', limit=6))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_store] = lambda: chat
    app.dependency_overrides[require_user_context] = lambda: UserContext('actor', 'owner', '', '')
    base = '/companion-runtime/photo-tasks/' + task_id
    with TestClient(app) as client:
        assert client.get(base).json()['step'] == 'select_photo'
        assert client.post(base + '/input', json=task_input('select', photo_id='mine')).status_code == 200
        assert client.post(base + '/input', json=task_input('cancel', operation='stale')).status_code == 409
        assert client.post(base + '/input', json=task_input('cancel', 2, 'cancel')).json()['status'] == 'cancelled'
        app.dependency_overrides[require_user_context] = lambda: UserContext('actor', 'other', '', '')
        assert client.get(base).status_code == 404
        assert client.post(base + '/input', json=task_input('cancel', 3, 'other')).status_code == 404
