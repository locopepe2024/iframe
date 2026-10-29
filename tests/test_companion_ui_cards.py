import pytest
from pydantic import ValidationError

from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Conflict, Missing
from src.apps.companion_runtime.tools import StartMediaDraft, UpdateMediaDraft
from src.apps.companion_runtime.ui_cards import SourceChoiceCopy


def test_model_copy_is_validated_and_actions_are_server_registered(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 'session')['session_id']
    values = StartMediaDraft(type='image_edit', source_choice={'title': '选一张想修改的照片吧'}).model_dump()
    task = store.start_media_draft('owner', 'actor', session, 'start', values)
    card = task['ui_card']
    assert card['props']['title'] == '选一张想修改的照片吧'
    assert card['task'] == dict(id=task['task_id'], revision=1)
    assert [o['action'] for o in card['props']['options']] == ['media.open_upload', 'media.open_album', 'media.pause']
    assert task['brief'] == ''
    assert store.media_draft('owner', 'actor', task['task_id'])['ui_card'] == card
    with pytest.raises(ValidationError):
        SourceChoiceCopy.model_validate({'title': '选图', 'url': 'https://example.com'})
    with pytest.raises(ValidationError):
        UpdateMediaDraft(task_id=task['task_id'], expected_revision=1, action='choose_source', option_id='execute')


def test_click_and_voice_share_navigation_and_reject_old_cards(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 'session')['session_id']
    task = store.start_media_draft('owner', 'actor', session, 'start', {'type': 'image_edit'})
    args = dict(expected_revision=1, action='choose_source', card_id=task['ui_card']['card_id'], option_id='album')
    click = store.update_media_draft('owner', 'actor', session, task['task_id'], 'click', args)
    voice = store.update_media_draft('owner', 'actor', session, task['task_id'], 'voice', dict(expected_revision=1, action='open_album'))
    assert click['task_id'] == voice['task_id'] == task['task_id']
    assert click['revision'] == voice['revision'] == 1
    assert click['ui_action'] == voice['ui_action'] == 'open_album'
    assert '已打开' not in click['spoken_text']
    assert store.update_media_draft('owner', 'actor', session, task['task_id'], 'click', args) == click
    assert 'ui_action' not in store.media_draft('owner', 'actor', task['task_id'])
    with pytest.raises(ValueError):
        store.update_media_draft('owner', 'actor', session, task['task_id'], 'wrong', {**args, 'card_id': 'another:1:source'})
    with pytest.raises(Missing):
        store.update_media_draft('owner', 'other', session, task['task_id'], 'other', args)
    changed = store.update_media_draft('owner', 'actor', session, task['task_id'], 'brief', dict(expected_revision=1, action='brief', brief='调亮'))
    assert changed['ui_card']['card_id'] != task['ui_card']['card_id']
    with pytest.raises(Conflict):
        store.update_media_draft('owner', 'actor', session, task['task_id'], 'stale', args)
    with pytest.raises(ValueError):
        store.update_media_draft('owner', 'actor', session, task['task_id'], 'old-card', {**args, 'expected_revision': 2})


def test_back_pauses_task_and_selected_photo_resolves_source_card(tmp_path, monkeypatch):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 'session')['session_id']
    task = store.start_media_draft('owner', 'actor', session, 'start', {'type': 'image_edit'})
    paused = store.update_media_draft('owner', 'actor', session, task['task_id'], 'back', dict(expected_revision=1, action='choose_source', card_id=task['ui_card']['card_id'], option_id='back'))
    assert paused['status'] == 'paused' and 'ui_card' not in paused
    store.update_media_draft('owner', 'actor', session, task['task_id'], 'resume', dict(expected_revision=2, action='resume'))
    monkeypatch.setattr('src.apps.companion_runtime.media_drafts.read_photos', lambda *args: {'photos': [{}]})
    selected = store.update_media_draft('owner', 'actor', session, task['task_id'], 'select', dict(expected_revision=3, action='select_photo', photo_id='mine'))
    assert selected['step'] == 'awaiting_brief' and 'ui_card' not in selected
