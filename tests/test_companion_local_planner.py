import pytest
from pydantic import ValidationError
from src.apps.companion_runtime.local_planner import check, Proposal


def plan(*steps):
    return {'decision': {'kind': 'image_edit', 'steps': list(steps)}}


def test_missing_asset_does_not_prevent_recording_concrete_requirements():
    result = check(plan({'tool': 'media.task.ensure'},
                        {'tool': 'media.brief.set', 'brief': '背景换海边，人物不变'},
                        {'tool': 'media.source.request', 'source': 'album'}), {})
    assert [s.tool for s in result.steps] == ['media.task.ensure', 'media.brief.set', 'media.source.request']


@pytest.mark.parametrize('steps', [
    [{'tool': 'media.source.request', 'source': 'album', 'brief': '调亮'}],
    [{'tool': 'media.source.request', 'source': 'album'}, {'tool': 'media.brief.set', 'brief': '调亮'}],
    [{'tool': 'media.brief.set', 'brief': '调亮'}, {'tool': 'media.task.ensure'}],
    [{'tool': 'media.task.ensure'}, {'tool': 'media.task.ensure'}],
    [{'tool': 'arbitrary.execute'}],
    [{'tool': 'media.task.cancel'}, {'tool': 'media.task.ensure'}],
])
def test_invalid_plans_are_rejected_before_execution(steps):
    with pytest.raises(ValidationError):
        Proposal.model_validate(plan(*steps))


def test_prerequisites_and_diary_focus_are_checked():
    with pytest.raises(ValueError):
        check(plan({'tool': 'media.brief.set', 'brief': '调亮'}), {})
    with pytest.raises(ValueError):
        check(plan({'tool': 'media.task.ensure'}), {'focus': 'diary_editor'})
    result = check({'decision': {'kind': 'delegate', 'capability': 'diary'}}, {'focus': 'diary_editor'})
    assert result.capability == 'diary'
    with pytest.raises(ValueError):
        check(plan({'tool': 'media.task.ensure'}), {'active': {'type': 'video_generate', 'status': 'active'}})
