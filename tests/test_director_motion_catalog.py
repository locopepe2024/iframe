import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('motion_catalog', Path(__file__).parents[1] / 'scripts/director3d/validate_motion_library_catalog.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def entry():
    return dict(motionId='walk', format='bvh', fps=24,
                source={'kind': 'local', 'url': None}, licenseStatus='verified',
                retargetStatus='validated', availability='ready',
                fileSha256='a'*64, targetRigSha256='b'*64,
                locomotion={'mode': 'in_place', 'nominalSpeedMps': 1.1,
                            'cycleSeconds': 1.2},
                contactValidation={'status': 'passed', 'reportSha256': 'c'*64})


def validate(item):
    return module.validate({'schema': 'director3d-motion-library.catalog.v1', 'entries': [item]})


def test_ready_requires_motion_evidence():
    assert validate(entry()) == []
    for key in ['fileSha256', 'targetRigSha256', 'contactValidation', 'locomotion']:
        item = entry(); del item[key]
        assert validate(item), key


@pytest.mark.parametrize('key,value', [('licenseStatus', 'needs_verification'), ('retargetStatus', 'mapped')])
def test_no_ready_claim_for_unverified_assets(key, value):
    item = entry(); item[key] = value
    assert validate(item)


@pytest.mark.parametrize('value', [True, float('nan'), float('inf'), 0, -1])
def test_rejects_invalid_speed(value):
    item = entry(); item['locomotion']['nominalSpeedMps'] = value
    assert validate(item)


def test_legacy_intake_remains_valid_and_untrusted_input_does_not_crash():
    payload = __import__('json').loads((Path(__file__).parents[1] / 'docs/examples/director3d/motion-library.catalog.v1.json').read_text())
    assert module.validate(payload) == []
    item = entry(); item['motionId'] = []
    assert validate(item)
