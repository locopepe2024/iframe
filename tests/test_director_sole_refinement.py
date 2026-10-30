import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts/director3d'))
from bounded_support_ik import bounded_refinement_offset, summarize_contact_phases


def sample(frame, weight, point):
    return {'frame': frame, 'weight': weight, 'soleWorldM': point,
            'anchorWorldM': [0, 0, 0], 'soleRegionWorldM': [point, [point[0]+.01, point[1], point[2]]],
            'soleAnchorResidualM': sum(v*v for v in point)**.5}


def test_phase_report_separates_released_and_locked_frames():
    result = summarize_contact_phases([sample(0, 0, [0, 0, .01]), sample(1, .5, [0, 0, .005]),
        sample(2, 1, [0, 0, 0]), sample(3, 1, [.001, 0, 0]), sample(4, 0, [0, 0, .02])], 24)
    assert result['released']['maxAnchorResidualM'] == .02
    assert result['ramp']['maxAnchorResidualM'] == .005
    assert result['fullWeight']['maxAnchorResidualM'] == .001
    assert result['fullWeight']['maxHorizontalSpeedMps'] == pytest.approx(.024)
    assert result['fullWeight']['maxPatchVertexSpeedMps'] == pytest.approx(.024)
    assert result['supportAccepted'] is False


def test_no_full_weight_frames_are_not_reported_as_zero_error():
    result = summarize_contact_phases([sample(0, 0, [0, 0, .01]), sample(1, .5, [0, 0, 0])], 24)
    assert result['fullWeight']['maxAnchorResidualM'] is None
    assert result['fullWeight']['maxHorizontalSpeedMps'] is None


def test_refinement_retains_cumulative_limit():
    with pytest.raises(ValueError, match='cumulative'):
        bounded_refinement_offset([0, 0, 0], [.049, 0, 0], [.049, 0, 0], [.051, 0, 0])
    assert bounded_refinement_offset([0, 0, 0], [.03, 0, 0], [.029, 0, 0], [.03, 0, 0]) == pytest.approx([.001, 0, 0])


def test_refinement_refuses_nonfinite_values():
    with pytest.raises(ValueError):
        bounded_refinement_offset([0, 0, 0], [0, 0, 0], [float('nan'), 0, 0], [0, 0, 0])


def test_patch_motion_is_visible_even_if_anchor_is_stationary():
    items = [sample(0, 1, [0, 0, 0]), sample(1, 1, [0, 0, 0])]
    items[1]['soleRegionWorldM'][1] = [.02, 0, -.008]
    result = summarize_contact_phases(items, 24)['fullWeight']
    assert result['maxAnchorResidualM'] == 0
    assert result['minPatchZM'] == -.008
    assert result['maxPatchVertexSpeedMps'] > .2


def test_contact_anchor_centroid_uses_full_patch_and_ground_plane():
    from bounded_support_ik import contact_anchor_from_patch
    assert contact_anchor_from_patch([[0, 0, .01], [2, 0, .02], [0, 2, .03]]) == [pytest.approx(2/3), pytest.approx(2/3), 0]


def test_contact_anchor_rejects_empty_or_nonfinite_patch():
    from bounded_support_ik import contact_anchor_from_patch
    with pytest.raises(ValueError):
        contact_anchor_from_patch([])
    with pytest.raises(ValueError):
        contact_anchor_from_patch([[float('nan'), 0, 0]])


def test_contact_plane_reports_tilt_and_residual():
    from bounded_support_ik import fit_contact_plane
    result = fit_contact_plane([[0, 0, 0], [1, 0, .1], [0, 1, 0], [1, 1, .1]])
    assert result['tiltDeg'] == pytest.approx(5.7106, rel=1e-3)
    assert result['maxAbsResidualM'] == pytest.approx(0)


def test_contact_plane_rejects_xy_collinear_points():
    from bounded_support_ik import fit_contact_plane
    with pytest.raises(ValueError, match='collinear'):
        fit_contact_plane([[0, 0, 0], [1, 0, .1], [2, 0, .2]])
