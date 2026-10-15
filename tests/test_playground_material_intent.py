from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from src.apps.playground.models import GenerateRequest
from src.apps.playground.service import PlaygroundService


@pytest.mark.parametrize('mode', ['t2i', 'i2i', 't2v', 'i2v', 'r2v', 'v2v'])
def test_unmentioned_materials_never_reach_resolution_or_generation_record(mode):
    read = Mock(side_effect=AssertionError('Unmentioned material must not be resolved'))
    storage = SimpleNamespace(resolve_media_reference=read,
        ensure_session=Mock(return_value=SimpleNamespace(id='session')),
        add_generation=Mock(), save_session_draft=Mock(), owner_user_id='user', owner_profile_id='owner')
    request = GenerateRequest(mode=mode, model_id='test', prompt='只使用文字',
        input_media=['/missing/image.jpg', '/missing/video.mp4'], media_names={'/missing/image.jpg': 'Image'})
    result = PlaygroundService(storage).create_generation(request)
    assert result.input_media == []
    assert result.media_names == {}
    read.assert_not_called()


def test_f2v_cannot_use_unmentioned_frames_to_meet_required_input_count():
    with pytest.raises(ValidationError, match='f2v requires exactly two images'):
        GenerateRequest(mode='f2v', model_id='test', prompt='只使用文字', input_media=['first.jpg', 'last.jpg'])


@pytest.mark.parametrize('mode', ['i2i', 'i2v', 'r2v', 'f2v', 'v2v'])
def test_explicit_reference_keeps_input_order_and_names(mode):
    references = ['first.jpg', 'last.jpg']
    names = {'first.jpg': 'First', 'last.jpg': 'Last'}
    request = GenerateRequest(mode=mode, model_id='test', prompt='从 @1 到 @2', input_media=references, media_names=names)
    assert request.input_media == references
    assert request.media_names == names
