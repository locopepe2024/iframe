import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('sole_metrics', Path(__file__).parents[1] / 'scripts/director3d/sole_contact_metrics.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def samples(*points):
    return [{"frame": i, "points": [p]} for i, p in enumerate(points)]


def test_fixed_vertices_near_plane_do_not_claim_support():
    result = module.summarize_sole(samples((0, 0, 0), (0, 0, 0)), 24)
    assert result['maxAdjacentNearGroundVertexSpeedMps'] == 0
    assert result['supportPhase'] == 'unclassified'
    assert result['status'] == 'diagnostic_only'


def test_speed_units_and_seam_displacement():
    result = module.summarize_sole(samples((0, 0, 0), (0.1, 0, 0)), 20)
    assert result['maxAdjacentNearGroundVertexSpeedMps'] == pytest.approx(2)
    assert result['endpointMaxVertexDisplacementM'] == pytest.approx(0.1)


def test_airborne_or_penetrating_vertices_are_not_slip_samples():
    result = module.summarize_sole(samples((0, 0, 0.3), (0.1, 0, -0.02)), 24)
    assert result['penetratingFrames'] == 1
    assert result['nearGroundFrames'] == 0
    assert result['maxAdjacentNearGroundVertexSpeedMps'] is None


@pytest.mark.parametrize('fps', [True, 0, -1, float('nan'), float('inf')])
def test_invalid_fps(fps):
    with pytest.raises(ValueError):
        module.summarize_sole(samples((0, 0, 0)), fps)


@pytest.mark.parametrize('bad', [[], [{'frame': 0, 'points': []}],
    [{'frame': 0, 'points': [(0, 0, float('nan'))]}],
    [{'frame': 0, 'points': [(0, 0, 0)]}, {'frame': 2, 'points': [(0, 0, 0)]}],
    [{'frame': 0, 'points': [(0, 0, 0)]}, {'frame': 1, 'points': [(0, 0, 0)]*2}]])
def test_invalid_samples(bad):
    with pytest.raises(ValueError):
        module.summarize_sole(bad, 24)
