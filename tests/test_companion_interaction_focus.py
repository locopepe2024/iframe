import pytest
from unittest.mock import Mock

from tests.test_companion_chat import chat
from src.apps.companion_runtime.interaction_focus import InteractionFocus


def body(operation='focus', revision=0, **extra):
    return dict(operation_id=operation, expected_revision=revision, focus=dict(
        kind='diary', object_id='2026-10-28', phase='editing', draft='今天和女儿喝茶。', **extra))


def test_focus_revision_idempotency_and_isolation(chat):
    store, _, client, session, _ = chat
    url=f'/companion-runtime/sessions/{session}/focus'
    assert client.get(url).json()['revision'] == 0
    request=body()
    first=client.put(url,json=request)
    assert first.status_code == 200
    assert client.put(url,json=request).json() == first.json()
    assert client.put(url,json=body('stale')).status_code == 409
    assert client.put(url,json=body('next',1)).json()['revision'] == 2
    other=store.session('another-owner','other')['session_id']
    assert client.get(f'/companion-runtime/sessions/{other}/focus').status_code == 404
    assert store.diaries('owner','actor','2026-10')['diaries'] == []


def test_retry_keeps_original_focus_snapshot(chat):
    store, _, client, session, _ = chat
    url=f'/companion-runtime/sessions/{session}/focus'
    client.put(url,json=body())
    claim=store.claim_turn('owner','actor',session,'chat-retry','我想继续讲')
    store.fail_turn('owner',claim)
    client.put(url,json=dict(operation_id='leave',expected_revision=1,focus=dict(kind='chat')))
    retry=store.claim_turn('owner','actor',session,'chat-retry','我想继续讲')
    assert retry['messages'][-1]['interaction_focus'] == claim['messages'][-1]['interaction_focus']
    assert retry['messages'][-1]['interaction_focus']['kind'] == 'diary'


@pytest.mark.parametrize('text',['女儿说怎么上传照片，后来我们一起喝茶。','帮我整理照片'])
def test_active_editor_bypasses_keyword_shortcuts(chat, monkeypatch, text):
    _, _, client, session, callback = chat
    callback.side_effect=None
    callback.return_value=dict(kind='text',text='这段回忆可以接着讲。')
    coordinator=Mock()
    monkeypatch.setattr('src.apps.companion_runtime.api.decide',coordinator,raising=False)
    client.put(f'/companion-runtime/sessions/{session}/focus',json=body())
    response=client.post(f'/companion-runtime/sessions/{session}/chat',json=dict(
        operation_id='narration',text=text,allow_external_text=True))
    assert response.status_code == 200,response.text
    assert response.json()['result']['kind'] == 'text'
    assert callback.call_args.args[1][-1]['interaction_focus']['draft'] == '今天和女儿喝茶。'
    coordinator.assert_not_called()


@pytest.mark.parametrize('values',[
    dict(kind='diary',object_id='2026-02-30'), dict(kind='photo'),
    dict(kind='chat',draft='private'), dict(kind='photo',object_id='p',draft='x'*4001),
])
def test_invalid_focus_is_rejected(values):
    with pytest.raises(ValueError): InteractionFocus(**values)


def test_photo_focus_checks_ownership_and_does_not_change_state_on_failure(chat,monkeypatch):
    from src.apps.photos.date_store import PhotoNotAvailable
    _, _, client, session, _ = chat
    photos=Mock()
    photos.read.side_effect=PhotoNotAvailable('not yours')
    monkeypatch.setattr('src.apps.companion_runtime.photo_tools.photo_store',lambda:photos)
    url=f'/companion-runtime/sessions/{session}/focus'
    response=client.put(url,json=dict(operation_id='photo',expected_revision=0,
        focus=dict(kind='photo',object_id='other-photo',phase='editing')))
    assert response.status_code == 404
    photos.read.assert_called_once_with('owner','other-photo')
    assert client.get(url).json()['revision'] == 0
