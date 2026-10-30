import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from world_route import validate_world_route


def payload():
    return {'schema': 'director3d-world-route.v1', 'sourceSha256': 'a' * 64,
            'targetSha256': 'b' * 64, 'evaluationFPS': 24,
            'provenance': 'design_hypothesis', 'evidence': 'authored straight path',
            'routes': [{'action': 'Walk', 'startFrame': 0, 'endFrame': 3,
                        'translationsM': [[0, 0, 0], [0.01, 0, 0], [0.02, 0, 0], [0.03, 0, 0]]}]}


def check(p, intervals=None):
    return validate_world_route(p, 'a' * 64, 'b' * 64, {'Walk': (0, 3)}, 24, intervals)


def test_complete_route_is_diagnostic_and_does_not_mutate_input():
    p = payload(); before = copy.deepcopy(p)
    result = check(p)
    assert result['status'] == 'diagnostic_only'
    assert result['routeApplied'] is False
    assert result['actions'][0]['maxSpeedMps'] == pytest.approx(0.24)
    assert p == before


@pytest.mark.parametrize('key,value', [('schema', 'wrong'), ('sourceSha256', 'c' * 64),
    ('targetSha256', 'c' * 64), ('evaluationFPS', 30), ('evaluationFPS', True),
    ('provenance', 'inferred_truth'), ('evidence', ''), ('routes', []), ('routes', None)])
def test_invalid_contract(key, value):
    p = payload(); p[key] = value
    with pytest.raises(ValueError):
        check(p)


@pytest.mark.parametrize('key,value', [('startFrame', 1), ('endFrame', 2), ('startFrame', False),
    ('action', 'Other'), ('translationsM', [[0, 0, 0]]),
    ('translationsM', [[0, 0, float('nan')]] * 4),
    ('translationsM', [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])])
def test_invalid_action_route(key, value):
    p = payload(); p['routes'][0][key] = value
    with pytest.raises(ValueError):
        check(p)


def test_duplicate_action_is_rejected():
    p = payload(); p['routes'] *= 2
    with pytest.raises(ValueError):
        check(p)


def test_support_slice_is_canonical_and_conflicts_fail():
    support = {'action': 'Walk', 'side': 'r', 'startFrame': 1, 'endFrame': 2,
               'routeTranslationsM': [[0.01, 0, 0], [0.02, 0, 0]]}
    result = check(payload(), [support])
    assert result['supportIntervals'][0]['routeTranslationsM'] == support['routeTranslationsM']
    support['routeTranslationsM'][1][0] = 1
    with pytest.raises(ValueError, match='support route conflicts'):
        check(payload(), [support])


@pytest.mark.parametrize('support', [[], [{'action': 'Unknown', 'side': 'l', 'startFrame': 0, 'endFrame': 1}],
    [{'action': 'Walk', 'side': 'l', 'startFrame': -1, 'endFrame': 1, 'routeTranslationsM': [[0, 0, 0]] * 3}]])
def test_malformed_support_input(support):
    with pytest.raises(ValueError):
        check(payload(), support)


def test_missing_selected_action_is_rejected():
    with pytest.raises(ValueError):
        validate_world_route(payload(), 'a'*64, 'b'*64, {'Walk': (0, 3), 'Run': (0, 3)}, 24)


def test_cli_writes_bound_result_and_rejects_stale_fps_without_output(tmp_path):
    import json
    import subprocess
    report = {'schema': 'director3d-retarget-diagnostic.v1',
              'sourceSha256': 'a'*64, 'targetSha256': 'b'*64, 'evaluationFPS': 24,
              'actions': [{'action': 'Walk', 'frameRange': [0, 3]}]}
    contract = tmp_path / 'retarget.json'; contract.write_text(json.dumps(report))
    route = tmp_path / 'route.json'; route.write_text(json.dumps(payload()))
    output = tmp_path / 'result.json'
    command = [sys.executable, str(Path(__file__).parents[1] / 'scripts/director3d/prepare_world_route.py'),
               '--retarget-report', str(contract), '--world-route', str(route), '--output', str(output)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    saved = json.loads(output.read_text())
    assert saved['routeApplied'] is False
    assert len(saved['inputSha256']['worldRoute']) == 64
    output.unlink()
    report.pop('evaluationFPS'); contract.write_text(json.dumps(report))
    failed = subprocess.run(command, capture_output=True, text=True)
    assert failed.returncode != 0
    assert 'evaluation FPS' in failed.stderr
    assert not output.exists()
