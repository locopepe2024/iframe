import pytest
from pydantic import ValidationError

from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Conflict, Missing
from src.apps.companion_runtime.tools import StartMediaDraft, UpdateMediaDraft, tool_schemas
from src.apps.companion_runtime.ui_cards import SourceChoiceCopy


def test_model_catalog_excludes_click_actions_and_binds_live_task_identifiers():
    def update(messages=None):
        return next(t for t in tool_schemas(messages) if t['name'] == 'media.draft.update')['parameters']['properties']
    props = update([{'active_media_draft': {'task_id': 'real-task', 'revision': 7}}])
    assert 'choose_source' not in props['action']['enum']
    assert 'card_id' not in props and 'option_id' not in props
    assert props['task_id']['enum'] == ['real-task']
    assert props['expected_revision']['enum'] == [7]
    # Building a schema for one turn must not leak its IDs into another turn.
    assert 'enum' not in update()['task_id']
    assert 'choose_source' in UpdateMediaDraft.model_json_schema()['properties']['action']['enum']


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


def test_video_asset_cards_follow_mode_and_slot_state():
    from src.apps.companion_runtime.ui_cards import asset_slot_card
    base = dict(task_id='video-task', revision=3, status='active', type='video_generate',
                video_mode='f2v', first_photo_id=None, last_photo_id=None, reference_photo_ids=[])
    first = asset_slot_card(base, 'first_frame')
    last = asset_slot_card(base, 'last_frame')
    assert first['card_id'].endswith(':first_frame') and last['card_id'].endswith(':last_frame')
    assert asset_slot_card({**base, 'first_photo_id': 'p1'}, 'first_frame') is None
    assert asset_slot_card({**base, 'video_mode': 'i2v'}, 'last_frame') is None
    assert asset_slot_card({**base, 'video_mode': 't2v'}, 'first_frame') is None


def test_reference_card_stops_after_nine_photos():
    from src.apps.companion_runtime.ui_cards import asset_slot_card
    task = dict(task_id='r', revision=1, status='active', type='video_generate',
                video_mode='r2v', first_photo_id=None, last_photo_id=None,
                reference_photo_ids=['p' + str(i) for i in range(9)])
    assert asset_slot_card(task, 'reference') is None
