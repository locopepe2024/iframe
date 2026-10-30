from unittest.mock import Mock

import pytest

from src.apps.companion_runtime.voice_attention import attention_reply
from tests.test_companion_chat import chat


@pytest.mark.parametrize('text', ['小安', '小安小安', '小安，小安。', '小安！'])
def test_attention_has_a_short_reply(text):
    assert attention_reply(text) == dict(kind='text', text='我在，您说。')


@pytest.mark.parametrize('text', ['小安打开相册', '小安，保存日记', '小安小韩。',
                                '我叫小安', '把备注改成小安', '安安', ''])
def test_real_requests_and_asr_approximations_are_not_attention(text):
    assert attention_reply(text) is None


def test_attention_keeps_history_and_task_without_model_calls(chat, monkeypatch):
    store, _, client, session, model = chat
    coordinator = Mock(side_effect=AssertionError('No coordinator for attention'))
    planner = Mock(side_effect=AssertionError('No planner for attention'))
    monkeypatch.setattr('src.apps.companion_runtime.api.decide', coordinator)
    monkeypatch.setattr('src.apps.companion_runtime.planner_runtime.plan_turn', planner)
    task = store.start_media_draft('owner', 'actor', session, 'draft', dict(type='image_edit', brief=''))
    body = dict(operation_id='attention', text='小安，小安。', allow_external_text=True)
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=body)
    assert result.status_code == 200, result.text
    assert result.json()['result'] == dict(kind='text', text='我在，您说。')
    assert client.post(f'/companion-runtime/sessions/{session}/chat', json=body).json() == result.json()
    messages = store.conversation('owner', 'actor', session)['messages']
    assert len(messages) == 1
    assert messages[0]['text'] == body['text']
    assert messages[0]['turn']['result'] == result.json()['result']
    assert store.media_draft('owner', 'actor', task['task_id']) == task
    model.assert_not_called()
    coordinator.assert_not_called()
    planner.assert_not_called()


def test_attention_does_not_consume_editor_dictation(chat):
    _, _, client, session, model = chat
    model.side_effect = None
    model.return_value = dict(kind='text', text='我记下这句话了。')
    response = client.put(f'/companion-runtime/sessions/{session}/focus', json=dict(
        operation_id='editor', expected_revision=0,
        focus=dict(kind='diary', object_id='2026-10-30', phase='editing', draft='今天')))
    assert response.status_code == 200
    response = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='narration', text='小安小安', allow_external_text=True))
    assert response.status_code == 200
    assert response.json()['result'] == model.return_value
    model.assert_called_once()
