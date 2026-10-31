from unittest.mock import Mock

import pytest

from src.apps.companion_runtime.voice_attention import attention_reply, silence_reply
from src.apps.companion_runtime.emotion import analyze
from src.apps.companion_runtime.response_gate import emotional_reply
from tests.test_companion_chat import chat


@pytest.mark.parametrize('text', ['小安', '小安小安', '小安，小安。', '小安！'])
def test_attention_has_a_short_reply(text):
    assert attention_reply(text) == dict(kind='text', text='我在，您说。')


@pytest.mark.parametrize('text', ['小安打开相册', '小安，保存日记', '小安小韩。',
                                '我叫小安', '把备注改成小安', '安安', ''])
def test_real_requests_and_asr_approximations_are_not_attention(text):
    assert attention_reply(text) is None


@pytest.mark.parametrize('text', ['嗯', '嗯嗯', '我听着'])
def test_low_information_acknowledgements_are_silent(text):
    assert silence_reply(text) == dict(kind='silent', reason='low_information')


@pytest.mark.parametrize('text', ['好，打开相册', '嗯，我想看看女儿的照片', '继续说今天的事'])
def test_real_requests_are_not_silenced(text):
    assert silence_reply(text) is None


@pytest.mark.parametrize('text,expected', [
    ('今天女儿来看我，我很开心', ('positive', 'celebrate')),
    ('我有点难过', ('negative', 'comfort')),
    ('一直失败，我很着急', ('negative', 'solve')),
    ('我不明白怎么打开', ('neutral', 'clarify')),
])
def test_emotion_signal_is_structured_and_conservative(text, expected):
    signal = analyze(text)
    assert (signal['valence'], signal['need']) == expected
    assert 0 < signal['confidence'] <= 1
    assert signal['evidence']


def test_unknown_emotion_does_not_claim_a_feeling():
    assert analyze('今天下午有风') == dict(
        valence='neutral', arousal='unknown', need='none', confidence=0.25, evidence=[])


def test_emotional_sharing_gets_one_short_acknowledgement():
    signal = analyze('我有点难过')
    assert emotional_reply('我有点难过', signal) == dict(
        kind='text', text='听起来这让您有些难过，我在听。', reason='emotion')


@pytest.mark.parametrize('text', ['我很着急，帮我重试', '我很难过，请打开日记'])
def test_emotion_does_not_steal_an_explicit_request(text):
    assert emotional_reply(text, analyze(text)) is None


def test_emotional_acknowledgement_does_not_call_model(chat):
    _, _, client, session, model = chat
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='emotion', text='我有点难过', allow_external_text=True))
    assert result.status_code == 200, result.text
    assert result.json()['result']['reason'] == 'emotion'
    model.assert_not_called()


def test_repeated_emotion_reaches_context_model(chat):
    _, _, client, session, model = chat
    first = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='emotion-first', text='我有点难过', allow_external_text=True))
    assert first.status_code == 200
    model.side_effect = None
    model.return_value = dict(kind='text', text='您想说说发生了什么吗？')
    second = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='emotion-second', text='我有点难过', allow_external_text=True))
    assert second.status_code == 200, second.text
    assert second.json()['result']['text'] == '您想说说发生了什么吗？'
    model.assert_called_once()


def test_silent_turn_does_not_call_model(chat, monkeypatch):
    _, _, client, session, model = chat
    coordinator = Mock(side_effect=AssertionError('No coordinator for filler'))
    monkeypatch.setattr('src.apps.companion_runtime.api.decide', coordinator)
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='filler', text='嗯嗯', allow_external_text=True))
    assert result.status_code == 200, result.text
    assert result.json()['result'] == dict(kind='silent', reason='low_information')
    model.assert_not_called()
    coordinator.assert_not_called()


def test_voice_context_is_the_same_bounded_snapshot_as_workflow_context(chat):
    _, _, client, session, model = chat
    model.side_effect = None
    model.return_value = dict(kind='text', text='收到。')
    for index, text in enumerate(['第一句', '第二句']):
        response = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
            operation_id=f'context-{index}', text=text, allow_external_text=True))
        assert response.status_code == 200, response.text
    workflow = client.get(f'/companion-runtime/sessions/{session}/workflow-context').json()
    voice = client.get(f'/companion-runtime/sessions/{session}/voice-context').json()
    assert voice == workflow
    assert [item['text'] for item in voice['recent_messages']] == ['第一句', '第二句']


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


@pytest.mark.parametrize('text', ['继续', '可以', '好', '好的', '行'])
def test_short_task_answers_are_never_globally_silenced(text):
    assert silence_reply(text) is None


@pytest.mark.parametrize('text', ['我不着急', '他很难过', '我不喜欢', '他说“我很难过”',
                                '失败了还能恢复吗', '我很开心，把它记下来', '谢谢'])
def test_ambiguous_emotion_never_short_circuits_model(text):
    assert emotional_reply(text, analyze(text)) is None


@pytest.mark.parametrize('text', ['嗯', '可以', '我有点难过'])
def test_active_creation_keeps_answers_in_model_context(chat, monkeypatch, text):
    store, _, client, session, model = chat
    monkeypatch.setattr('src.apps.companion_runtime.api.decide', lambda *args: None)
    monkeypatch.setattr('src.apps.companion_runtime.planner_runtime.plan_turn', lambda *args: None)
    task = store.start_media_draft('owner', 'actor', session, 'draft', dict(type='image_edit', brief=''))
    model.side_effect = None
    model.return_value = dict(kind='text', text='请选一张要修改的照片。')
    result = client.post(f'/companion-runtime/sessions/{session}/chat', json=dict(
        operation_id='task-answer', text=text, allow_external_text=True))
    assert result.status_code == 200, result.text
    assert result.json()['result']['text'] == '请选一张要修改的照片。'
    model.assert_called_once()
    assert model.call_args.args[1][-1]['active_media_draft']['task_id'] == task['task_id']
