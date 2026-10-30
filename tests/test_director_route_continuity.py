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
    assert result['speedViolations'][0]['fromFrame'] == 0


def test_adjacent_cross_foot_boundary_is_measured():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0.01, 0, 0]]),
                                        interval('r', 2, [[1, 0, 0], [1.01, 0, 0]])], 24)
    assert result['gaps'] == []
    assert result['speedViolations'][0]['fromFrame'] == 1
    assert result['speedViolations'][0]['toFrame'] == 2
    assert result['continuous'] is False


def test_slow_adjacent_boundary_passes_regardless_of_side():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0.01, 0, 0]]),
                                        interval('r', 2, [[0.02, 0, 0], [0.03, 0, 0]])], 24)
    assert result['gaps'] == []
    assert result['continuous'] is True


@pytest.mark.parametrize('side', ['l', 'r'])
def test_unobserved_frames_block_continuity(side):
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0.01, 0, 0]]),
                                        interval(side, 5, [[0.02, 0, 0], [0.03, 0, 0]])], 24)
    assert result['gaps'][0]['gapFrames'] == 3
    assert result['gaps'][0]['boundaryChecked'] is False
    assert result['continuous'] is False


def test_overlapping_inconsistent_routes_block_continuity():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0], [0, 0, 0]]),
                                        interval('r', 0, [[1, 0, 0], [1, 0, 0]])], 24)
    assert result['continuous'] is False
    assert result['conflicts']


def test_other_foot_can_supply_missing_route_samples():
    result = validate_route_continuity([interval('l', 0, [[0, 0, 0]] * 2),
                                        interval('r', 1, [[0, 0, 0]] * 5),
                                        interval('l', 5, [[0, 0, 0]] * 2)], 24)
    assert result['continuous'] is True
    assert result['gaps'] == []


@pytest.mark.parametrize('bad', [[], [interval('l', 0, [[0, 0, 0], [float('nan'), 0, 0]])]])
def test_invalid_route_samples(bad):
    with pytest.raises(ValueError):
        validate_route_continuity(bad, 24)


@pytest.mark.parametrize('fps,limit', [(True, 4), (24, 0), (0, 4), (float('nan'), 4)])
def test_invalid_route_limits(fps, limit):
    with pytest.raises(ValueError):
        validate_route_continuity([interval('l', 0, [[0, 0, 0], [0, 0, 0]])], fps, limit)


def test_different_actions_do_not_share_a_timeline():
    left = dict(interval('l', 0, [[0, 0, 0]] * 2), action='walk')
    right = dict(interval('r', 0, [[10, 0, 0]] * 2), action='run')
    assert validate_route_continuity([left, right], 24)['continuous'] is True
