import pytest
from src.apps.recreation.prompt_contract import compile_h3, guidance_snapshot


def test_shared_guidance_has_identity():
    snapshot = guidance_snapshot()
    assert len(snapshot['sha256']) == 64
    assert snapshot['packages']
    assert 'subject_definitions' in snapshot['instructions']


def test_native_silence_and_replacement_contract():
    prompt, errors = compile_h3('A hand lifts the product.', 'Replace the yellow box with <Picture 2>.',
                                replacement=True, duration=5, audio_policy='silent', soundscape='')
    assert errors == []
    assert 'Continue for 5 seconds.' in prompt
    assert 'overall_soundscape:\nN/A' in prompt


@pytest.mark.parametrize('sound', ['Use @2', 'Use <Audio 1>', 'Use <Picture 3>'])
def test_unattached_sound_references_fail(sound):
    _, errors = compile_h3('A hand lifts the box.', '', replacement=False, duration=5,
                           audio_policy='generated', soundscape=sound)
    assert errors


def test_explicit_sound_is_preserved():
    prompt, errors = compile_h3('Static camera.', '', replacement=False, duration=5,
                               audio_policy='generated', soundscape='Footsteps only. No dialogue.')
    assert not errors
    assert 'Footsteps only. No dialogue.' in prompt
