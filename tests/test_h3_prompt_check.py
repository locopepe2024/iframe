"""Check submitted Ref2VA structure, not visual understanding or model quality."""
import pytest
from scripts.check_h3_prompt import check_prompt


def prompt(cuts=(4.017, 9.083, 10.400)):
    shots = '[Shot 1] The family holds the box from <Picture 1>. '
    for n, cut in enumerate(cuts, 2):
        shots += f'[Shot {n}] At 00:{cut:06.3f}, show the next composition. '
    return ('subject_definitions:\n<Subject 1> is the family from <Picture 1> and <Picture 2>.\n'
            'summary:\n[reference generation] Show <Subject 1>.\n'
            'retention_analysis:\n<Subject 1>: fully_preserved - Keep appearance.\n'
            f'detailed_description:\n{shots}Continue until 15 seconds.\n'
            'overall_soundscape:\nN/A\nnon_diegetic_music:\nN/A')


def check(text, **kwargs):
    return check_prompt(text, duration=15, pictures=2, videos=0, audios=0, **kwargs)


def test_four_shots_and_real_media_slots_pass():
    assert check(prompt(), silent=True, cuts=[4.017, 9.083, 10.400]) == []


def test_three_shot_sample_based_timeline_requires_external_evidence_to_reject():
    sample = prompt((4.483, 10.500))
    assert check(sample) == []  # Syntax alone cannot find an omitted close-up.
    assert 'cuts_mismatch' in check(sample, cuts=[4.017, 9.083, 10.400])


@pytest.mark.parametrize('old,new,code', [
    ('<Picture 2>', '<Picture 3>', 'media_range'),
    ('<Picture 2>', '<Video 2>', 'media_range'),
    ('<Picture 2>', '@2', 'mixed_reference_syntax'),
    ('<Picture 2>', '[Picture 2]', 'mixed_reference_syntax'),
    ('<Picture 2>', 'Picture 2', 'mixed_reference_syntax'),
    ('<Subject 1>.', '<Subject 2>.', 'undefined_subject'),
    ('00:04.017', '04:017', 'cut_format'),
    ('00:04.017', '00:64.017', 'cut_format'),
    ('00:10.400', '00:09.000', 'cut_order'),
    ('00:10.400', '00:15.000', 'cut_range'),
    ('[Shot 1]', '[Shot 1] At 00:00.000,', 'first_shot_timestamp'),
    ('[Shot 3]', '[Shot 5]', 'shot_sequence'),
    ('summary:', 'synopsis:', 'section_order'),
])
def test_rejects_structural_failures(old, new, code):
    assert code in check(prompt().replace(old, new))


def test_silence_is_explicit_and_not_inferred_from_absent_audio():
    text = prompt().replace('overall_soundscape:\nN/A', 'overall_soundscape:\nClinking tableware.')
    assert check(text) == []
    assert 'silence_fields' in check(text, silent=True)
