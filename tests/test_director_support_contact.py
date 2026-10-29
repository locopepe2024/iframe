import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('support', Path(__file__).parents[1] / 'scripts/director3d/support_contact_metrics.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def payload():
    return {'schema': 'director3d-support-annotations.v1', 'sourceSha256': 'a', 'targetSha256': 'b',
            'intervals': [{'action': 'Walk', 'side': 'l', 'startFrame': 0, 'endFrame': 1,
                           'mesh': 'body', 'vertexIndex': 12, 'provenance': 'design_hypothesis',
                           'evidence': 'trial interval', 'routeTranslationsM': [[0, 0, 0], [0.1, 0, 0]]}]}


def test_explicit_route_cancels_in_place_motion():
    result = module.measure_interval([[0, 0, 0.01], [-0.1, 0, 0.01]], [[0, 0, 0], [0.1, 0, 0]], 24)
    assert result['maxHorizontalDriftM'] == 0
    assert result['requestedAnchorOffsetsM'] == [[0, 0, -0.01]]*2
    assert result['solverApplied'] is False


def test_wrong_route_reports_drift_instead_of_hiding_it():
    result = module.measure_interval([[0, 0, 0], [-0.1, 0, 0]], [[0, 0, 0]]*2, 24)
    assert result['maxHorizontalDriftM'] == pytest.approx(0.1)
    assert result['maxHorizontalSpeedMps'] == pytest.approx(2.4)


def test_annotation_identity_and_overlap():
    p = payload()
    assert module.validate_annotations(p, 'a', 'b', {'Walk': (0, 32)}) == p['intervals']
    with pytest.raises(ValueError):
        module.validate_annotations(p, 'other', 'b', {'Walk': (0, 32)})
    p['intervals'] *= 2
    with pytest.raises(ValueError):
        module.validate_annotations(p, 'a', 'b', {'Walk': (0, 32)})


@pytest.mark.parametrize('key,value', [('startFrame', True), ('endFrame', 40), ('routeTranslationsM', []),
    ('routeTranslationsM', [[0, 0, 0], [float('nan'), 0, 0]]), ('vertexIndex', True),
    ('provenance', 'auto'), ('evidence', ''), ('action', 'Unknown')])
def test_invalid_annotation(key, value):
    p = payload(); p['intervals'][0][key] = value
    with pytest.raises(ValueError):
        module.validate_annotations(p, 'a', 'b', {'Walk': (0, 32)})


@pytest.mark.parametrize('fps', [0, True, float('inf')])
def test_invalid_fps(fps):
    with pytest.raises(ValueError):
        module.measure_interval([[0, 0, 0]]*2, [[0, 0, 0]]*2, fps)
