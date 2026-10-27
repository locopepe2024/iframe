import pytest
from pydantic import ValidationError

from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.tools import CAPABILITIES, MODELS, dispatch


def test_capabilities_and_diary_reads_do_not_mutate(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    store.save_diary('owner', 'actor', '2026-10-27', operation_id='save', text='今天散步了。', source_turn_id='', expected_revision=0)
    assert {c['name'] for c in CAPABILITIES} == {'album', 'diary', 'memory'}
    assert {t for c in CAPABILITIES for t in c['tools']} == set(MODELS)
    assert dispatch(store, 'owner', 'actor', 'diary.open', {})['open_calendar']
    listed = dispatch(store, 'owner', 'actor', 'diary.list', {'month': '2026-10'})
    assert len(listed['diaries']) == 1
    assert dispatch(store, 'owner', 'actor', 'diary.read', {'day': '2026-10-27'})['diaries'] == listed['diaries']
    assert dispatch(store, 'other', 'actor', 'diary.read', {'day': '2026-10-27'})['diaries'] == []
    assert dispatch(store, 'owner', 'other', 'diary.list', {'month': '2026-10'})['diaries'] == []
    assert dispatch(store, 'owner', 'actor', 'diary.read', {'day': '2026-10-26'})['diaries'] == []
    assert store.diaries('owner', 'actor', '2026-10')['diaries'][0]['revision'] == 1
    for name, args in [('diary.open', {'owner': 'other'}), ('diary.list', {'month': '2026-13'}), ('diary.read', {'day': '2026-02-30'})]:
        with pytest.raises(ValidationError):
            dispatch(store, 'owner', 'actor', name, args)


def test_diary_tool_round_trip_uses_diary_result_not_memory(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    claim = store.claim_turn('owner', 'actor', session, 't', '打开日记')
    turn = store.finish_turn('owner', 'actor', claim, dict(kind='tool', name='diary.open', arguments={}))
    assert turn['result']['kind'] == 'diary_read'
    assert store.conversation('owner', 'actor', session)['messages'][0]['turn'] == turn
    assert store.turn('owner', 'actor', turn['turn_id']) == turn
