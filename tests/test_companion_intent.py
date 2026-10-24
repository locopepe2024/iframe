from src.apps.companion_runtime.intent import classify, diary_day


def test_diary_intent_accepts_polite_and_direct_wording():
    assert classify('请把 2026-10-24 我们聊的内容整理成一篇回忆日记。').name == 'diary.compose'
    assert diary_day('把 2026-10-24 我们聊的内容整理成一篇回忆日记。') == '2026-10-24'


def test_unrelated_chat_stays_chat():
    assert classify('今天女儿来看我了。').name == 'chat'


def test_upload_question_uses_upload_help_lane():
    assert classify('怎么发').name == 'media.upload_help'
    assert classify('我想从相册选一张照片').name == 'media.upload_help'
