import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from shared_route_metrics import validate_shared_routes


def interval(side, start, route):
    return {'side': side, 'startFrame': start, 'endFrame': start+len(route)-1, 'routeTranslationsM': route}


def test_overlapping_feet_must_share_same_world_route():
    result = validate_shared_routes([interval('l', 0, [[0, 0, 0], [1, 0, 0]]),
                                     interval('r', 0, [[0, 0, 0], [1, 0, 0]])])
    assert result['shared'] is True
    assert result['conflicts'] == []


def test_independent_fitted_routes_are_rejected():
    result = validate_shared_routes([interval('l', 0, [[0, 0, 0], [1, 0, 0]]),
                                     interval('r', 0, [[0, 0, 0], [1.1, 0, 0]])])
    assert result['shared'] is False
    assert result['conflicts'][0]['frame'] == 1


def test_non_overlapping_intervals_do_not_conflict():
    result = validate_shared_routes([interval('l', 0, [[0, 0, 0], [1, 0, 0]]),
                                     interval('r', 2, [[9, 0, 0], [10, 0, 0]])])
    assert result['shared'] is True
    assert result['coveredFrames'] == [0, 1, 2, 3]


@pytest.mark.parametrize('bad', [[], [{'side': 'x', 'startFrame': 0, 'endFrame': 1, 'routeTranslationsM': [[0, 0, 0], [0, 0, 0]]}],
    [{'side': 'l', 'startFrame': 0, 'endFrame': 2, 'routeTranslationsM': [[0, 0, 0]]}],
    [{'side': 'l', 'startFrame': 0, 'endFrame': 1, 'routeTranslationsM': [[0, 0, float('nan')], [0, 0, 0]]}]])
def test_invalid_route(bad):
    with pytest.raises(ValueError):
        validate_shared_routes(bad)


def test_caller_gates_keep_actions_with_same_frames_independent():
    from shared_route_metrics import validate_route_continuity
    intervals = [dict(interval('l', 0, [[0, 0, 0]] * 2), action='Walk'),
                 dict(interval('r', 0, [[10, 0, 0]] * 2), action='Run')]
    # Same sequence as the retarget probe's pre-IK gates.
    shared = validate_shared_routes(intervals)
    continuous = validate_route_continuity(intervals, 24)
    assert shared['shared'] is True
    assert continuous['continuous'] is True
    assert shared['coveredFramesByAction'] == {'Walk': [0, 1], 'Run': [0, 1]}


def test_same_action_conflict_is_still_rejected_and_identified():
    intervals = [dict(interval('l', 0, [[0, 0, 0]] * 2), action='Walk'),
                 dict(interval('r', 0, [[10, 0, 0]] * 2), action='Walk'),
                 dict(interval('r', 0, [[0, 0, 0]] * 2), action='Run')]
    result = validate_shared_routes(intervals)
    assert result['shared'] is False
    assert {c['action'] for c in result['conflicts']} == {'Walk'}


@pytest.mark.parametrize('action', [True, 1, [], {}])
def test_invalid_shared_route_action(action):
    with pytest.raises(ValueError):
        validate_shared_routes([dict(interval('l', 0, [[0, 0, 0]] * 2), action=action)])
