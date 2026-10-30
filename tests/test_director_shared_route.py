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
