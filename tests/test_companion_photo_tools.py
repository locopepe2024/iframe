"""Real photo storage behind Agent tool and persisted chat results."""
import sqlite3

import pytest
from pydantic import ValidationError

from src.apps.photos.workflow import PhotoWorkflowStore
from src.apps.photos.dates import PhotoTimeEvidence
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Missing
from src.apps.companion_runtime.tools import dispatch


def test_album_count_is_global_owner_scoped_read_only_and_excludes_deleted(stores):
    chat, photos = stores
    for i in range(20):
        photos.register_photo('owner', 'batch', f'extra-{i}', PhotoTimeEvidence())
    photos.delete_photo('owner', 'mine', 'actor', operation_id='remove')
    with sqlite3.connect(photos.path) as db:
        before = '\n'.join(db.iterdump())
    result = dispatch(chat, 'owner', 'actor', 'photo.album.count', {})
    assert result == dict(total=20, spoken_text='相册里一共有20张照片。')
    assert dispatch(chat, 'empty-owner', 'actor', 'photo.album.count', {})['total'] == 0
    for arguments in ({'owner': 'other'}, {'limit': 6}, {'year': 2026}):
        with pytest.raises(ValidationError):
            dispatch(chat, 'owner', 'actor', 'photo.album.count', arguments)
    with sqlite3.connect(photos.path) as db:
        assert '\n'.join(db.iterdump()) == before


@pytest.mark.parametrize('text', [
    '呃，我们现在里面一共有多少张照片？',
    '相册里面一共有多少张照片？',
    '呃，我我我我是说我们现在有多少张照片？',
])
def test_count_question_result_is_text_snapshot_not_organize_guide(stores, text):
    from src.apps.companion_runtime.intent import classify
    chat, photos = stores
    assert classify(text).name == 'chat'  # Interpretation stays with the model.
    session = chat.session('owner', 'count')['session_id']
    claim = chat.claim_turn('owner', 'actor', session, 'count', text)
    turn = chat.finish_turn('owner', 'actor', claim,
        dict(kind='tool', name='photo.album.count', arguments={}))
    assert turn['result']['kind'] == 'text'
    assert turn['result']['text'] == '相册里一共有1张照片。'
    with chat.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM companion_photo_tasks').fetchone()[0] == 0
    photos.register_photo('owner', 'batch', 'new', PhotoTimeEvidence())
    assert chat.turn('owner', 'actor', turn['turn_id']) == turn
    assert chat.conversation('owner', 'actor', session)['messages'][0]['turn'] == turn
    next_claim = chat.claim_turn('owner', 'actor', session, 'count-again', text)
    assert chat.finish_turn('owner', 'actor', next_claim,
        dict(kind='tool', name='photo.album.count', arguments={}))['result']['text'] == '相册里一共有2张照片。'


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


def test_combined_photo_search_via_chat_tool_is_persisted_and_owner_scoped(stores):
    chat, photos = stores
    from src.apps.photos.annotations import PhotoFacts
    facts = PhotoFacts(location='海边', capture_time='2025-10', notes='和女儿散步').model_dump()
    for owner, photo_id in [('owner', 'mine'), ('other', 'theirs')]:
        photos.save_annotations(owner, photo_id, 'actor', operation_id='facts', expected_revision=0, facts=facts)
    session = chat.session('owner', 'search-session')['session_id']
    claim = chat.claim_turn('owner', 'actor', session, 'search-turn', '找2025年女儿在海边的照片')
    result = chat.finish_turn('owner', 'actor', claim, dict(kind='tool', name='photo.album.list',
        arguments=dict(year=2025, query='女儿 海边')))['result']
    assert [photo['photo_id'] for photo in result['photos']] == ['mine']
    assert result['photos'][0]['search_matches'][0]['source'] == 'facts'
    assert chat.conversation('owner', 'actor', session)['messages'][0]['turn']['result'] == result
    assert dispatch(chat, 'owner', 'actor', 'photo.album.list', dict(query='女儿 山里'))['photos'] == []


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


def test_spoken_task_continuation_context_and_transaction(stores):
    chat, _ = stores
    session = chat.session('owner', 'voice-session')['session_id']
    first = chat.claim_turn('owner', 'actor', session, 'start', '帮我整理没有日期的照片')
    task = chat.finish_turn('owner', 'actor', first,
        dict(kind='tool', name='photo.organize.start', arguments={'view': 'pending'}))['result']
    next_turn = chat.claim_turn('owner', 'actor', session, 'select', '先整理第一张')
    context = next_turn['messages'][-1]['workflow_tasks'][0]
    assert context == dict(task_id=task['task_id'], revision=1, step='select_photo',
                           candidate_ids=['mine'], selected_id=None)
    assert task['spoken_text'] == '找到1张照片，您想先整理第几张？'
    # The workflow context is server data, never persisted as the user's words.
    assert 'workflow_tasks' not in chat.messages('owner', session)['messages'][-1]
    selected = chat.finish_turn('owner', 'actor', next_turn, dict(kind='tool', name='photo.organize.input',
        arguments=dict(task_id=task['task_id'], expected_revision=1, action='select', photo_id='mine')))
    assert selected['result']['step'] == 'review_photo'
    assert selected['result']['spoken_text'].startswith('选好这张了')
    assert chat.claim_turn('owner', 'actor', session, 'select', '先整理第一张')['cached']
    assert chat.photo_task('owner', 'actor', task['task_id'])['revision'] == 2
    cancel = chat.claim_turn('owner', 'actor', session, 'cancel', '取消整理')
    result = chat.finish_turn('owner', 'actor', cancel, dict(kind='tool', name='photo.organize.input',
        arguments=dict(task_id=task['task_id'], expected_revision=2, action='cancel')))
    assert result['result']['spoken_text'] == '已取消本次整理。'
    after = chat.claim_turn('owner', 'actor', session, 'after', '我们聊别的')
    assert 'workflow_tasks' not in after['messages'][-1]


def test_model_cannot_continue_a_different_session_task(stores):
    chat, _ = stores
    source = chat.session('owner', 'source')['session_id']
    elsewhere = chat.session('owner', 'elsewhere')['session_id']
    task_id = chat.start_photo_task('owner', 'actor', source, 'task',
        dict(view='all', year=None, query='', after_id='', limit=6))
    claim = chat.claim_turn('owner', 'actor', elsewhere, 'wrong', '取消整理')
    assert 'workflow_tasks' not in claim['messages'][-1]
    with pytest.raises(Missing):
        chat.finish_turn('owner', 'actor', claim, dict(kind='tool', name='photo.organize.input',
            arguments=dict(task_id=task_id, expected_revision=1, action='cancel')))
    assert chat.photo_task('owner', 'actor', task_id)['revision'] == 1
    assert chat.turn('owner', 'actor', claim['id'])['status'] == 'running'


def test_explicit_photo_selection_creates_single_persisted_workspace(stores):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.apps.companion_runtime.api import router, get_store
    from src.apps.identity import UserContext, require_user_context
    chat, _ = stores
    session = chat.session('owner', 'picked-session')['session_id']
    app = FastAPI(); app.include_router(router)
    app.dependency_overrides[get_store] = lambda: chat
    app.dependency_overrides[require_user_context] = lambda: UserContext('actor', 'owner', '', '')
    with TestClient(app) as client:
        body = dict(operation_id='picked', text='整理这张照片', selected_photo_id='mine', allow_external_text=True)
        result = client.post(f'/companion-runtime/sessions/{session}/chat', json=body)
        assert result.status_code == 200, result.text
        turn = result.json()
        assert turn['result']['step'] == 'review_photo'
        assert [p['photo_id'] for p in turn['result']['photos']] == ['mine']
        assert client.post(f'/companion-runtime/sessions/{session}/chat', json=body).json() == turn
        assert chat.workflow_context('owner', 'actor', session)['album_tasks'][0]['selected']
        assert client.get('/companion-runtime/turns/' + turn['turn_id']).json() == turn
        assert client.post(f'/companion-runtime/sessions/{session}/chat', json={**body, 'operation_id': 'other-photo', 'selected_photo_id': 'theirs'}).status_code == 404
        assert client.post(f'/companion-runtime/sessions/{session}/chat', json={**body, 'operation_id': 'missing-photo', 'selected_photo_id': 'absent'}).status_code == 404


def test_photo_action_requires_selection_and_never_mutates_without_confirmation(stores):
    chat, photos = stores
    session = chat.session('owner','action-session')['session_id']
    proposal = dict(kind='tool',name='photo.action',arguments=dict(photo_id='mine',action='edit',changes={'location':'杭州'}))
    claim = chat.claim_turn('owner','actor',session,'unselected','地点改成杭州')
    with pytest.raises(ValueError,match='Select this photo'):
        chat.finish_turn('owner','actor',claim,proposal)
    task = chat.start_photo_task('owner','actor',session,'choose',dict(photo_id='mine'))
    claim = chat.claim_turn('owner','actor',session,'edit','地点改成杭州')
    assert claim['messages'][-1]['workflow_tasks'][0]['selected_photo']['annotations']['revision'] == 0
    result = chat.finish_turn('owner','actor',claim,proposal)['result']
    assert result['kind'] == 'photo_action' and result['facts']['location'] == '杭州'
    assert result['expected_revision'] == 0
    assert photos.annotations('owner','mine')['facts']['location'] == ''
    photos.delete_photo('owner','mine','actor',operation_id='delete-selected')
    assert chat.photo_task('owner','actor',task)['photos'] == []
    assert chat.conversation('owner','actor',session)['messages']


def test_selection_is_part_of_turn_retry_identity(stores):
    from src.apps.companion_runtime.store import Conflict
    chat, _ = stores
    session = chat.session('owner','select-idempotency')['session_id']
    claim = chat.claim_turn('owner','actor',session,'select-turn','选择这张照片','mine')
    chat.finish_turn('owner','actor',claim,dict(kind='tool',name='photo.organize.start',arguments={'photo_id':'mine'}))
    assert chat.claim_turn('owner','actor',session,'select-turn','选择这张照片','mine')['cached']
    for changed in ('theirs',None):
        with pytest.raises(Conflict,match='Selected photo changed'):
            chat.claim_turn('owner','actor',session,'select-turn','选择这张照片',changed)

def test_photo_action_accepts_current_viewer_focus_without_mutating(stores):
    from src.apps.companion_runtime.interaction_focus import update_focus
    chat, photos = stores
    session = chat.session('owner','viewer-action')['session_id']
    update_focus(chat,'owner','actor',session,dict(operation_id='view',expected_revision=0,
        focus=dict(kind='photo',object_id='mine',phase='viewing',draft='')))
    claim = chat.claim_turn('owner','actor',session,'analyze-viewed','分析这张照片')
    result = chat.finish_turn('owner','actor',claim,dict(kind='tool',name='photo.action',
        arguments=dict(photo_id='mine',action='analyze',changes={})))['result']
    assert result['kind'] == 'photo_action'
    assert result['photo_id'] == 'mine'
    assert photos.annotations('owner','mine')['revision'] == 0
