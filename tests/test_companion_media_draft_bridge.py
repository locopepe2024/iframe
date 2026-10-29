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


def test_source_card_rejects_non_source_slot_until_frame_card_exists(tmp_path):
    _, _, task = setup(tmp_path)
    with pytest.raises(Conflict):
        selection_event_from_draft(task, card_id=task['ui_card']['card_id'], photo_id='photo', slot='first_frame')


def test_video_frame_card_event_maps_to_existing_frame_action(tmp_path, monkeypatch):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 'frame-session')['session_id']
    task = store.start_media_draft('owner', 'actor', session, 'start-frame',
        {'type': 'video_generate', 'video_mode': 'f2v'})
    # Build the same card contract used by the draft display for the first slot.
    from src.apps.companion_runtime.ui_cards import asset_slot_card
    card = asset_slot_card(task, 'first_frame')
    assert card
    event = selection_event_from_draft({**task, 'type': 'video_generate', 'video_mode': 'f2v'},
        card_id=card['card_id'], photo_id='first', slot='first_frame')
    assert bind_arguments(task, event, event_id='frame-event').slot == 'first_frame'
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    changed = apply_selection(store, 'owner', 'actor', session, task, event, operation_id='frame-event')
    assert changed['first_photo_id'] == 'first'

@pytest.mark.parametrize('kind,slot,mode', [
    ('image_edit', 'source', None), ('image_generate', 'source', None),
    ('video_generate', 'first_frame', 'f2v'), ('video_generate', 'last_frame', 'f2v'),
])
def test_current_selection_cards_support_adding_and_replacing_assets(tmp_path, monkeypatch, kind, slot, mode):
    store = ChatStore(tmp_path / 'replace.db', initialize=True)
    session = store.session('owner', 'replacement')['session_id']
    values = {'type': kind}
    if mode:
        values['video_mode'] = mode
    task = store.start_media_draft('owner', 'actor', session, 'start', values)
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    for revision, photo in ((1, 'original'), (2, 'replacement')):
        card_id = task['selection_cards'][slot]
        event = selection_event_from_draft(task, card_id=card_id, photo_id=photo, slot=slot)
        task = apply_selection(store, 'owner', 'actor', session, task, event, operation_id=f'bind-{revision}')
        field = {'source': 'photo_id', 'first_frame': 'first_photo_id', 'last_frame': 'last_photo_id'}[slot]
        assert task[field] == photo and task['revision'] == revision + 1
        with pytest.raises(Conflict):
            selection_event_from_draft(task, card_id=card_id, photo_id='stale', slot=slot)
