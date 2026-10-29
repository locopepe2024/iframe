import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from bounded_support_ik import blend_weight, solve_leg


def test_segment_lengths_and_pole_preserved():
    hip, knee, ankle = [0, 0, 1], [0, -0.2, 0.5], [0, 0, 0]
    result = solve_leg(hip, knee, ankle, [0.02, 0, 0.02], 1)
    assert math.dist(hip, result['knee']) == pytest.approx(math.dist(hip, knee))
    assert math.dist(result['knee'], result['ankle']) == pytest.approx(math.dist(knee, ankle))
    assert result['knee'][1] < 0
    assert result['ankle'] == [0.02, 0, 0.02]


def test_zero_weight_keeps_original_pose():
    result = solve_leg([0, 0, 1], [0, -0.2, 0.5], [0, 0, 0], [0.02, 0, 0], 0)
    assert result['knee'] == pytest.approx([0, -0.2, 0.5])
    assert result['ankle'] == [0, 0, 0]


@pytest.mark.parametrize('offset', [[0.051, 0, 0], [float('nan'), 0, 0], [True, 0, 0]])
def test_rejects_unsafe_requests(offset):
    with pytest.raises(ValueError):
        solve_leg([0, 0, 1], [0, -0.2, 0.5], [0, 0, 0], offset, 1)


def test_unreachable_and_ambiguous_pose_rejected():
    with pytest.raises(ValueError):
        solve_leg([0, 0, 1], [0, 0, 0.5], [0, 0, 0], [0, 0, -0.01], 1)
    with pytest.raises(ValueError):
        solve_leg([0, 0, 1], [0, 0, 0.5], [0, 0, 0], [0, 0, 0], 1)


def test_entry_exit_envelope():
    assert [blend_weight(f, 0, 4) for f in range(5)] == [0, 0.5, 1, 0.5, 0]
    with pytest.raises(ValueError):
        blend_weight(0, 0, 3)
