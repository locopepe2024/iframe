import pytest
from scripts.companion_eval.planner_comparison import expand


def test_intent_expansion_records_requirements_before_requesting_source():
    decision = expand({'intent': 'edit', 'brief': '背景换海边，人物不变', 'source': 'album'}, {})
    assert decision['steps'] == [
        {'tool': 'media.task.ensure'},
        {'tool': 'media.brief.set', 'brief': '背景换海边，人物不变'},
        {'tool': 'media.source.request', 'source': 'album'},
    ]


def test_existing_task_is_continued_without_recreation():
    state = {'active': {'type': 'image_edit', 'status': 'active'}}
    assert expand({'intent': 'edit', 'brief': '', 'source': 'upload'}, state)['steps'] == [
        {'tool': 'media.source.request', 'source': 'upload'}]


@pytest.mark.parametrize('value,state', [
    ({'intent': 'edit', 'brief': '', 'source': 'ask'}, {'focus': 'diary_editor'}),
    ({'intent': 'cancel', 'brief': '', 'source': 'none'}, {}),
    ({'intent': 'chat', 'brief': '调亮', 'source': 'none'}, {}),
    ({'intent': 'edit', 'brief': '', 'source': 'ask'}, {'active': {'type': 'video_generate', 'status': 'active'}}),
])
def test_expansion_cannot_bypass_state_or_parameter_checks(value, state):
    with pytest.raises(ValueError):
        expand(value, state)
