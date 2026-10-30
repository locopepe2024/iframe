"""Regression for evaluated geometry comparison used by the media Blender runner."""
import copy
import importlib.util
from pathlib import Path

import pytest

path = Path(__file__).parents[1] / 'scripts/director3d/check_world_route_playback.py'
spec = importlib.util.spec_from_file_location('playback_check', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def reports():
    a = {'actions': [{'action': 'Walk', 'samples': [
        {'frame': 0, 'sourcePointsM': {'pelvis': [0, 0, 1]},
         'targetPointsM': {'pelvis': [0, 0, 1]}, 'routeOffsetM': [0, 0, 0]}],
        'annotatedSupport': []}]}
    sa = {'actions': [{'vertices': {'l': [1], 'r': [2]}, 'samples': {
        side: [{'frame': 0, 'points': [[0, 0, 0]]}] for side in ('l', 'r')}}]}
    b, sb = copy.deepcopy(a), copy.deepcopy(sa)
    b['actions'][0]['samples'][0]['routeOffsetM'] = [1, 0, 0]
    b['actions'][0]['samples'][0]['targetPointsM']['pelvis'][0] = 1
    for side in ('l', 'r'):
        sb['actions'][0]['samples'][side][0]['points'][0][0] = 1
    return a, b, sa, sb


def test_world_geometry_matches_one_route_application():
    assert module.compare(*reports()) == 0


@pytest.mark.parametrize('fault', ['double_offset', 'source_moved', 'missing_vertex', 'nan'])
def test_geometry_comparison_detects_application_errors(fault):
    a, b, sa, sb = reports()
    if fault == 'double_offset':
        sb['actions'][0]['samples']['r'][0]['points'][0][0] = 2
    elif fault == 'source_moved':
        b['actions'][0]['samples'][0]['sourcePointsM']['pelvis'][0] = 1
    elif fault == 'missing_vertex':
        sb['actions'][0]['samples']['r'][0]['points'] = []
    else:
        sb['actions'][0]['samples']['r'][0]['points'][0][0] = float('nan')
    with pytest.raises(AssertionError):
        module.compare(a, b, sa, sb)
