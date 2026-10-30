import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from bounded_support_ik import validate_cycle_samples


def sample(frame, weight, residual=0.0001):
    return {'frame': frame, 'weight': weight, 'ankleResidualM': residual,
            'kneeResidualM': residual, 'soleAnchorResidualM': residual}


def test_cycle_gate_reports_release_without_accepting_contact():
    result = validate_cycle_samples([sample(0, 0), sample(1, .5), sample(2, 1), sample(3, .5), sample(4, 0)], 24)
    assert result['entryWeight'] == 0
    assert result['exitWeight'] == 0
    assert result['maxWeightStep'] == .5
    assert result['supportAccepted'] is False


@pytest.mark.parametrize('bad', [
    [sample(0, 0), sample(2, 1)],
    [sample(0, 0), sample(1, 1.2)],
    [sample(0, 1), sample(1, 0)],
])
def test_cycle_gate_rejects_invalid_or_non_releasing_samples(bad):
    with pytest.raises(ValueError):
        validate_cycle_samples(bad, 24)


@pytest.mark.parametrize('key,value', [('ankleResidualM', float('nan')),
    ('kneeResidualM', -0.01), ('soleAnchorResidualM', True), ('weight', True)])
def test_invalid_residual_or_boolean_weight(key, value):
    items = [sample(0, 0), sample(1, 0)]
    items[0][key] = value
    with pytest.raises(ValueError):
        validate_cycle_samples(items, 24)


def test_both_endpoint_residuals_reported_without_claiming_seam():
    result = validate_cycle_samples([sample(0, 0, 0.01), sample(1, 0, 0.02)], 24)
    assert result['endpointSoleResidualM'] == [0.01, 0.02]
