from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.conversation_context import read_summary


def test_previous_question_is_available_for_short_answer(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    first = store.claim_turn('owner', 'actor', session, 'first', '今天女儿来了')
    store.finish_turn('owner', 'actor', first, dict(kind='text', text='你们一起做了什么？'))
    second = store.claim_turn('owner', 'actor', session, 'second', '喝茶')
    assert second['messages'][0]['assistant_reply']['text'] == '你们一起做了什么？'
    assert second['messages'][1]['text'] == '喝茶'
    assert 'assistant_reply' not in second['messages'][1]
    assert second['messages'][0]['id'] == first['message_id']


def test_context_does_not_cross_actor_or_session_or_include_failed_reply(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    first = store.claim_turn('owner', 'actor', session, 'first', '你好')
    store.finish_turn('owner', 'actor', first, dict(kind='text', text='私有回复'))
    other_actor = store.claim_turn('owner', 'another', session, 'second', '继续')
    assert all('assistant_reply' not in m for m in other_actor['messages'])
    other_session = store.session('owner', 'other-session')['session_id']
    third = store.claim_turn('owner', 'actor', other_session, 'third', '继续')
    assert len(third['messages']) == 1
    store.fail_turn('owner', third)
    fourth = store.claim_turn('owner', 'actor', other_session, 'fourth', '再说一次')
    assert all('assistant_reply' not in m for m in fourth['messages'])


def test_confirmation_is_not_a_success_receipt(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    first = store.claim_turn('owner', 'actor', session, 'first', '请记住我喜欢散步')
    store.finish_turn('owner', 'actor', first, dict(kind='tool', name='memory.save', arguments=dict(
        source_message_id=first['message_id'], quote='喜欢散步', content='喜欢散步',
        type='preference', importance=3)))
    second = store.claim_turn('owner', 'actor', session, 'second', '继续')
    assert second['messages'][0]['assistant_reply']['status'] == 'confirmation_requested_outcome_unknown'


def test_read_summary_does_not_copy_private_bodies():
    assert read_summary('memory.search', {'memories':[{'content':'private'}]}) is None
    assert read_summary('diary.read', {'diaries':[{'day':'2026-10-28','text':'private'}]}) == dict(days=['2026-10-28'], open_calendar=False)
    assert read_summary('photo.album.list', {'photos':[{'photo_id':'p'}], 'next_after_id':'p'}) == dict(photo_ids=['p'], has_more=True)


def test_calendar_summary_keeps_marked_dates_without_diary_bodies():
    assert read_summary('diary.list', {'days':['2026-10-28'], 'diaries':[], 'open_calendar':True}) == dict(days=['2026-10-28'], open_calendar=True)


def test_diary_save_receipt_is_shared_and_does_not_reopen_previous_photo_task(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    draft = store.claim_turn('owner', 'actor', session, 'draft', '请把 2026-10-28 我们聊的内容整理成一篇回忆日记。')
    source = store.finish_turn('owner', 'actor', draft, dict(kind='text', text='今天翻看了照片。'))
    save = store.claim_turn('owner', 'actor', session, 'save', '把日记保存。')
    store.finish_turn('owner', 'actor', save, dict(kind='tool', name='diary.save_draft', arguments={'source_turn_id':source['turn_id']}))
    next_turn = store.claim_turn('owner', 'actor', session, 'next', '保存了吗？')
    receipt = next_turn['messages'][-2]['assistant_reply']
    assert receipt['tool'] == 'diary.save_draft'
    assert receipt['operation_status'] == 'saved'
    assert receipt['day'] == '2026-10-28'
    assert next_turn['messages'][-1]['last_operation'] == dict(tool='diary.save_draft', status='saved', day='2026-10-28')


def test_last_operation_survives_twenty_messages_but_never_crosses_session(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    draft = store.claim_turn('owner', 'actor', session, 'draft', '请把 2026-10-28 我们聊的内容整理成一篇回忆日记。')
    source = store.finish_turn('owner', 'actor', draft, dict(kind='text', text='今天翻看了照片。'))
    save = store.claim_turn('owner', 'actor', session, 'save', '把日记保存。')
    store.finish_turn('owner', 'actor', save, dict(kind='tool', name='diary.save_draft', arguments={'source_turn_id':source['turn_id']}))
    for index in range(21):
        turn = store.claim_turn('owner', 'actor', session, f'chat-{index}', '你好')
        store.finish_turn('owner', 'actor', turn, dict(kind='text', text='你好。'))
    current = store.claim_turn('owner', 'actor', session, 'check', '保存了吗')
    assert current['messages'][-1]['last_operation']['status'] == 'saved'
    other = store.session('owner', 'elsewhere')['session_id']
    elsewhere = store.claim_turn('owner', 'actor', other, 'other', '你好')
    assert 'last_operation' not in elsewhere['messages'][-1]
    different_actor = store.claim_turn('owner', 'other-actor', session, 'different-actor', '你好')
    assert 'last_operation' not in different_actor['messages'][-1]


def test_failed_save_is_not_a_completed_task_receipt(tmp_path):
    store = ChatStore(tmp_path / 'chat.db', initialize=True)
    session = store.session('owner', 's')['session_id']
    draft = store.claim_turn('owner', 'actor', session, 'draft', '请把 2026-10-28 我们聊的内容整理成一篇回忆日记。')
    source = store.finish_turn('owner', 'actor', draft, dict(kind='text', text='今天翻看了照片。'))
    store.save_diary('owner','actor','2026-10-28',operation_id='existing',text='手动修改后的日记',source_turn_id='',expected_revision=0)
    save = store.claim_turn('owner', 'actor', session, 'save', '保存')
    store.finish_turn('owner', 'actor', save, dict(kind='tool', name='diary.save_draft', arguments={'source_turn_id':source['turn_id']}))
    current = store.claim_turn('owner', 'actor', session, 'check', '保存了吗')
    assert current['messages'][-1]['last_operation']['status'] == 'needs_review'
