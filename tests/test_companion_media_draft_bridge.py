import pytest
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.media_draft_bridge import (
    apply_selection, bind_arguments, selection_event_from_draft, source_request_from_draft)
from src.apps.companion_runtime.store import Conflict


def setup(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 'session')['session_id']
    task = store.start_media_draft('owner', 'actor', session, 'start', {'type': 'image_edit'})
    return store, session, task


def test_existing_source_card_maps_to_registered_wait(tmp_path):
    _, _, task = setup(tmp_path)
    request = source_request_from_draft(task)
    assert request.task_id == task['task_id']
    assert request.revision == 1 and request.status == 'waiting_user'
    assert request.card_id == task['ui_card']['card_id']


def test_stale_card_cannot_produce_selection_or_bind_arguments(tmp_path):
    _, _, task = setup(tmp_path)
    with pytest.raises(Conflict):
        selection_event_from_draft(task, card_id='old:1:source', photo_id='photo')
    event = selection_event_from_draft(task, card_id=task['ui_card']['card_id'], photo_id='photo')
    assert bind_arguments(task, event, event_id='evt-1').selection_event_id == 'evt-1'


def test_real_draft_selection_uses_verified_event_and_is_idempotent(tmp_path, monkeypatch):
    store, session, task = setup(tmp_path)
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    event = selection_event_from_draft(task, card_id=task['ui_card']['card_id'], photo_id='photo')
    selected = apply_selection(store, 'owner', 'actor', session, task, event, operation_id='evt-1')
    assert selected['photo_id'] == 'photo' and selected['revision'] == 2
    assert apply_selection(store, 'owner', 'actor', session, task, event, operation_id='evt-1') == selected
    with pytest.raises(Conflict):
        apply_selection(store, 'owner', 'actor', session, selected, event, operation_id='evt-2')
