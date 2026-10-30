import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from shared_route_metrics import validate_route_continuity


def interval(side, start, route):
    return {'side': side, 'startFrame': start, 'endFrame': start+len(route)-1, 'routeTranslationsM': route}


def test_route_speed_is_measured_in_world_units():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0.1, 0, 0]])], 24, 4)
    assert result['segments'][0]['maxSpeedMps'] == pytest.approx(2.4)
    assert result['continuous'] is True


def test_fast_fitted_jump_is_rejected():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [1, 0, 0]])], 24, 4)
    assert result['continuous'] is False
    assert result['speedViolations'][0]['side'] == 'l'


def test_adjacent_intervals_without_bridge_samples_are_not_claimed_continuous():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0.01, 0, 0]]),
                                        interval('l', 2, [[0.02, 0, 0], [0.03, 0, 0]])], 24)
    assert result['gaps'][0]['boundaryChecked'] is False
    assert result['continuous'] is False


@pytest.mark.parametrize('fps,limit', [(True, 4), (24, 0), (0, 4), (float('nan'), 4)])
def test_invalid_route_limits(fps, limit):
    with pytest.raises(ValueError):
        validate_route_continuity([interval('l', 0, [[0, 0, 0], [0, 0, 0]])], fps, limit)
