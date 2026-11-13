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


@pytest.mark.parametrize('mode', ['i2i', 'r2v', 'f2v'])
def test_only_two_named_references_from_seven_reach_storage_and_adapter(mode, monkeypatch, tmp_path):
    refs = [f'/playground/input-media/{i}.png' for i in range(1, 8)]
    names = {ref: f'reference-{i}.png' for i, ref in enumerate(refs, 1)}
    selected = [refs[1], refs[3]]
    resolve = Mock(side_effect=lambda ref: ref if ref in selected else (_ for _ in ()).throw(AssertionError('Unused media resolved')))
    storage = SimpleNamespace(resolve_media_reference=resolve, media_root=str(tmp_path),
        ensure_session=Mock(return_value=SimpleNamespace(id='session')),
        add_generation=Mock(), save_session_draft=Mock(), owner_user_id='user', owner_profile_id='owner')
    prompt = '@reference-2.png 与 @reference-4.png，@reference-2.png 保持外观'
    request = GenerateRequest(mode=mode, model_id='nsfw/seedream_5.0Pro_nsfw', prompt=prompt,
        input_media=refs, media_names=names, parameters={'aspect_ratio': '9:16'})
    service = PlaygroundService(storage, nsfw_config_loader=lambda: {})
    generation = service.create_generation(request)
    assert generation.input_media == selected
    assert generation.reference_contexts == [None, None]
    assert generation.media_names == {ref: names[ref] for ref in selected}
    assert generation.prompt == prompt
    assert resolve.call_count == 2
    assert storage.save_session_draft.call_args.args[1].input_media == selected
    if mode == 'i2i':
        adapter = Mock()
        monkeypatch.setattr('src.models.nsfw_new_one.NSFWNewOneImageModel', lambda config: adapter)
        service._generate_image_mulerouter(generation, '/unused/output.png', 0)
        assert adapter.generate.call_args.kwargs['ref_image_paths'] == selected
        assert adapter.generate.call_args.kwargs['aspect_ratio'] == '9:16'


def test_ordinal_references_rebase_without_changing_the_referenced_materials():
    refs = [f'{i}.png' for i in range(1, 8)]
    request = GenerateRequest(mode='r2v', model_id='test', prompt='从 @7 到 @2，再 @7', input_media=refs)
    assert request.input_media == [refs[1], refs[6]]
    assert request.prompt == '从 @2 到 @1，再 @2'
    # A second validation must retain both the prompt bindings and the inputs.
    repeated = GenerateRequest.model_validate(request.model_dump())
    assert repeated.input_media == request.input_media
    assert repeated.prompt == request.prompt


def test_unrelated_at_and_filename_prefix_never_attach_candidates():
    request = GenerateRequest(mode='i2i', model_id='test', prompt='@portrait.png.backup @提醒',
        input_media=['portrait.png'], media_names={'portrait.png': 'portrait.png'})
    assert request.input_media == []


def test_out_of_range_ordinal_cannot_silently_bind_another_candidate():
    with pytest.raises(ValidationError, match='outside the selected material list'):
        GenerateRequest(mode='i2i', model_id='test', prompt='@8', input_media=['one.png'])


def test_signed_reference_names_and_legacy_short_labels_remain_bound():
    one = '/playground/input-media/a.png?signature=expired'
    two = '/playground/input-media/b.png?signature=expired'
    request = GenerateRequest(mode='i2i', model_id='test', prompt='@portr... 用作参考',
        input_media=[one, two], media_names={'/playground/input-media/a.png': 'portrait.png', '/playground/input-media/b.png': 'other.png'})
    assert request.input_media == [one]
    assert request.media_names == {'/playground/input-media/a.png': 'portrait.png'}


def test_mixed_named_and_numeric_references_preserve_names_and_rebase_only_indices():
    refs = [f'{i}.png' for i in range(1, 8)]
    request = GenerateRequest(mode='i2i', model_id='test', prompt='@portrait.png 与 @7',
        input_media=refs, media_names={refs[3]: 'portrait.png'})
    assert request.input_media == [refs[3], refs[6]]
    assert request.prompt == '@portrait.png 与 @2'


def test_ambiguous_named_reference_requires_an_explicit_index():
    with pytest.raises(ValidationError, match='duplicate names'):
        GenerateRequest(mode='i2i', model_id='test', prompt='@portrait.png',
            input_media=['one.png', 'two.png'], media_names={'one.png': 'portrait.png', 'two.png': 'portrait.png'})
