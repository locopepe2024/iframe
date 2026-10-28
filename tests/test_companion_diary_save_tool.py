import pytest
from src.apps.companion_runtime.chat_store import ChatStore
from src.apps.companion_runtime.store import Missing


def draft(store, session):
    claim=store.claim_turn('owner','actor',session,'draft','请把 2026-10-28 我们聊的内容整理成一篇回忆日记。')
    return store.finish_turn('owner','actor',claim,dict(kind='text',text='今天和女儿喝茶。'))['turn_id']


def test_save_existing_draft_exactly_once_and_keeps_history(tmp_path):
    store=ChatStore(tmp_path/'chat.db',initialize=True)
    session=store.session('owner','s')['session_id']
    source=draft(store,session)
    claim=store.claim_turn('owner','actor',session,'save','我看了把日记保存一下吧。')
    proposal=dict(kind='tool',name='diary.save_draft',arguments={'source_turn_id':source})
    result=store.finish_turn('owner','actor',claim,proposal)
    assert result['result']['text']=='2026-10-28 的日记已保存。'
    saved=store.diaries('owner','actor','2026-10')['diaries'][0]
    assert saved['text']=='今天和女儿喝茶。' and saved['revision']==1
    assert store.turn('owner','actor',result['turn_id'])==result
    again=store.claim_turn('owner','actor',session,'again','保存刚才日记')
    assert store.finish_turn('owner','actor',again,proposal)['result']['text']=='这篇日记已经保存了。'
    assert store.diaries('owner','actor','2026-10')['diaries'][0]['revision']==1


def test_save_cannot_select_other_session_or_ordinary_chat_or_overwrite(tmp_path):
    store=ChatStore(tmp_path/'chat.db',initialize=True)
    session=store.session('owner','s')['session_id'];source=draft(store,session)
    other=store.session('owner','other')['session_id']
    claim=store.claim_turn('owner','actor',other,'save','保存日记')
    with pytest.raises(Missing):
        store.finish_turn('owner','actor',claim,dict(kind='tool',name='diary.save_draft',arguments={'source_turn_id':source}))
    store.save_diary('owner','actor','2026-10-28',operation_id='manual',text='用户已编辑的版本',source_turn_id='',expected_revision=0)
    claim=store.claim_turn('owner','actor',session,'save-current','保存日记')
    result=store.finish_turn('owner','actor',claim,dict(kind='tool',name='diary.save_draft',arguments={'source_turn_id':source}))
    assert '已有日记' in result['result']['text']
    assert store.diaries('owner','actor','2026-10')['diaries'][0]['text']=='用户已编辑的版本'


def test_save_refuses_unsaved_editor_changes_and_non_diary_source(tmp_path):
    store=ChatStore(tmp_path/'chat.db',initialize=True)
    session=store.session('owner','s')['session_id'];source=draft(store,session)
    claim=store.claim_turn('owner','actor',session,'save','保存日记')
    claim['messages'][-1]['interaction_focus']=dict(kind='diary',object_id='2026-10-28',phase='editing',draft='刚刚修改的正文')
    result=store.finish_turn('owner','actor',claim,dict(kind='tool',name='diary.save_draft',arguments={'source_turn_id':source}))
    assert '还有修改' in result['result']['text']
    assert store.diaries('owner','actor','2026-10')['diaries']==[]
    ordinary=store.claim_turn('owner','actor',session,'ordinary','你好')
    turn=store.finish_turn('owner','actor',ordinary,dict(kind='text',text='你好'))
    claim=store.claim_turn('owner','actor',session,'wrong','保存日记')
    result=store.finish_turn('owner','actor',claim,dict(kind='tool',name='diary.save_draft',arguments={'source_turn_id':turn['turn_id']}))
    assert '还没有确定日期' in result['result']['text']


def test_multiturn_diary_source_with_explicit_model_date(tmp_path):
    store=ChatStore(tmp_path/'chat.db',initialize=True)
    session=store.session('owner','s')['session_id']
    first=store.claim_turn('owner','actor',session,'day','我们写一下2026年10月28号的日记。')
    store.finish_turn('owner','actor',first,dict(kind='text',text='想写什么？'))
    body=store.claim_turn('owner','actor',session,'body','写刚才那张照片。')
    source=store.finish_turn('owner','actor',body,dict(kind='text',text='10月28日\n今天翻看了一张照片。'))
    save=store.claim_turn('owner','actor',session,'save','把刚写的日记保存。')
    result=store.finish_turn('owner','actor',save,dict(kind='tool',name='diary.save_draft',arguments=dict(source_turn_id=source['turn_id'],day='2026-10-28')))
    assert result['result']['text']=='2026-10-28 的日记已保存。'
    assert store.diaries('owner','actor','2026-10')['diaries'][0]['text']==source['result']['text']
