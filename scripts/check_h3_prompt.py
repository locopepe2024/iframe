"""Offline Ref2VA syntax checks. No model calls; PASS does not verify visual content."""
import argparse
import json
import math
from pathlib import Path
import re

SECTIONS = ('subject_definitions', 'summary', 'retention_analysis',
            'detailed_description', 'overall_soundscape', 'non_diegetic_music')
LABEL = re.compile(r'<(Subject|Picture|Video|Audio) ([1-9]\d*)>')
SHOT = re.compile(r'\[Shot ([1-9]\d*)\]')
CUT = re.compile(r'At (\d{2}):([0-5]\d)\.(\d{3}),')


def check_prompt(text, *, duration, pictures, videos, audios, silent=False, cuts=None):
    if not math.isfinite(duration) or duration <= 0 or min(pictures, videos, audios) < 0:
        raise ValueError('Duration must be positive and media counts nonnegative')
    if cuts is not None and (any(not math.isfinite(t) or not 0 < t < duration for t in cuts)
                             or any(b <= a for a, b in zip(cuts, cuts[1:]))):
        raise ValueError('Known cuts must be finite, increasing and inside the duration')
    errors = []
    headers = list(re.finditer(r'^(' + '|'.join(SECTIONS) + r'):\s*$', text, re.M))
    if [m[1] for m in headers] != list(SECTIONS):
        return ['section_order']
    parts = {m[1]: text[m.end():headers[i+1].start() if i+1 < len(headers) else len(text)].strip()
             for i, m in enumerate(headers)}
    if any(not value for value in parts.values()):
        errors.append('empty_section')
    if text[:headers[0].start()].strip():
        errors.append('unexpected_preamble')
    # Strip valid labels before finding competing or malformed media syntax.
    remainder = LABEL.sub('', text)
    if re.search(r'@(?:\d+|[^\s<>]+)|\b(?:Picture|Video|Audio)\s*\d+', remainder, re.I):
        errors.append('mixed_reference_syntax')
    counts = {'Picture': pictures, 'Video': videos, 'Audio': audios}
    if any(int(m[2]) > counts[m[1]] for m in LABEL.finditer(text) if m[1] in counts):
        errors.append('media_range')
    defined = {int(m[1]) for m in re.finditer(r'^<Subject ([1-9]\d*)>\s', parts['subject_definitions'], re.M)}
    if any(int(m[2]) not in defined for m in LABEL.finditer(text) if m[1] == 'Subject'):
        errors.append('undefined_subject')
    timeline = parts['detailed_description']
    shots = list(SHOT.finditer(timeline))
    if not shots or [int(m[1]) for m in shots] != list(range(1, len(shots)+1)):
        errors.append('shot_sequence')
    actual_cuts = []
    for i, shot in enumerate(shots):
        body = timeline[shot.end():shots[i+1].start() if i+1 < len(shots) else len(timeline)].lstrip()
        match = CUT.match(body)
        if i == 0:
            if re.match(r'At\s+\d', body):
                errors.append('first_shot_timestamp')
        elif match is None:
            errors.append('cut_format')
        else:
            actual_cuts.append(int(match[1])*60 + int(match[2]) + int(match[3])/1000)
    if any(not 0 < t < duration for t in actual_cuts):
        errors.append('cut_range')
    if any(b <= a for a, b in zip(actual_cuts, actual_cuts[1:])):
        errors.append('cut_order')
    if cuts is not None and (len(actual_cuts) != len(cuts)
                            or any(abs(a-b) > 0.001 for a, b in zip(actual_cuts, cuts))):
        errors.append('cuts_mismatch')
    if silent and any(parts[name] != 'N/A' for name in SECTIONS[-2:]):
        errors.append('silence_fields')
    return list(dict.fromkeys(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prompt', type=Path)
    parser.add_argument('--duration', type=float, required=True)
    for name in ('pictures', 'videos', 'audios'):
        parser.add_argument('--'+name, type=int, required=True)
    parser.add_argument('--silent', action='store_true')
    parser.add_argument('--cuts', help='Independently verified comma-separated cut times, in seconds')
    args = vars(parser.parse_args())
    text = args.pop('prompt').read_text(encoding='utf-8')
    try:
        args['cuts'] = [float(t) for t in args['cuts'].split(',')] if args['cuts'] is not None else None
        errors = check_prompt(text, **args)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps({'status': 'FAIL' if errors else 'PASS', 'errors': errors,
                      'scope': 'Ref2VA structure only; visual fidelity and upstream acceptance unverified'}))
    raise SystemExit(bool(errors))


if __name__ == '__main__':
    main()
