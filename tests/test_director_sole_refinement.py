import math
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


def test_bounded_plane_correction_returns_unapplied_request():
    from bounded_support_ik import bounded_plane_correction
    result = bounded_plane_correction([[0, 0, 0], [1, 0, .01], [0, 1, 0]])
    assert result['applied'] is False
    assert result['angleDeg'] == pytest.approx(0.5729, rel=1e-3)
    assert result['planeResidualM'] == pytest.approx(0)


def test_bounded_plane_correction_rejects_large_tilt():
    from bounded_support_ik import bounded_plane_correction
    with pytest.raises(ValueError, match='tilt'):
        bounded_plane_correction([[0, 0, 0], [1, 0, .3], [0, 1, 0]])


def test_ground_patch_filters_high_vertices_by_height_band():
    from bounded_support_ik import select_ground_patch
    result = select_ground_patch([[0, 0, 0], [1, 0, .005], [0, 1, .009], [0, 0, .04]])
    assert result['selectedCount'] == 3
    assert result['totalCount'] == 4


def test_ground_patch_rejects_invalid_band():
    from bounded_support_ik import select_ground_patch
    with pytest.raises(ValueError):
        select_ground_patch([[0, 0, 0]], 0)


@pytest.mark.parametrize('a,b', [(0.04, 0), (0, -.07), (.04, -.06), (-.05, .03), (0, 0)])
def test_requested_rotation_flattens_contact_geometry(a, b):
    from bounded_support_ik import bounded_plane_correction, fit_contact_plane
    points = [[x, y, a*x+b*y] for x, y in [(0, 0), (.1, 0), (0, .1), (.1, .1)]]
    request = bounded_plane_correction(points)
    axis = request['axisWorld']
    angle = math.radians(request['angleDeg'])
    # Rodrigues' rotation, independent of the slope-to-axis implementation.
    rotated = []
    for p in points:
        cross = [axis[1]*p[2]-axis[2]*p[1], axis[2]*p[0]-axis[0]*p[2], axis[0]*p[1]-axis[1]*p[0]]
        projection = sum(x*y for x, y in zip(axis, p))
        rotated.append([p[i]*math.cos(angle)+cross[i]*math.sin(angle)
                        +axis[i]*projection*(1-math.cos(angle)) for i in range(3)])
    assert fit_contact_plane(rotated)['tiltDeg'] < 1e-8
    assert max(p[2] for p in rotated)-min(p[2] for p in rotated) < 1e-10


def test_plane_fit_is_stable_under_large_world_translation():
    from bounded_support_ik import fit_contact_plane
    points = [[x, y, .04*x-.03*y] for x, y in [(0, 0), (.1, 0), (0, .1), (.1, .1)]]
    moved = [[x+1e6, y-1e6, z+100] for x, y, z in points]
    assert fit_contact_plane(moved)['slopeXY'] == pytest.approx([.04, -.03], abs=1e-8)
    assert fit_contact_plane(moved)['maxAbsResidualM'] < 1e-8


@pytest.mark.parametrize('scale', [.001, 1, 1000])
def test_plane_rank_check_is_independent_of_patch_scale(scale):
    from bounded_support_ik import fit_contact_plane
    points = [[scale*x, scale*y, scale*.03*x] for x, y in [(0, 0), (.1, 0), (0, .1)]]
    assert fit_contact_plane(points)['slopeXY'] == pytest.approx([.03, 0])
    with pytest.raises(ValueError, match='collinear'):
        fit_contact_plane([[0, 0, 0], [scale, 0, .03*scale], [scale, 1e-8*scale, .03*scale]])


@pytest.mark.parametrize('patch', [
    [[0, 0, 0], [.1, 0, 0], [.2, 0, 0], [0, .1, .02]],
    [[0, 0, 0], [.1, 0, .02], [0, .1, .03], [.1, .1, .04]],
])
def test_filtered_degenerate_patch_is_rejected_without_losing_phase_metrics(patch):
    item = sample(0, 1, [0, 0, 0])
    item['soleRegionWorldM'] = patch
    report = summarize_contact_phases([item], 24)['fullWeight']
    assert report['maxAnchorResidualM'] == 0
    assert report['patchPlane'] is None
    assert report['planeCorrection']['status'] == 'rejected'
    assert report['planeCorrection']['applied'] is False


def test_phase_reports_each_frame_including_later_unsafe_tilt():
    items = [sample(0, 1, [0, 0, 0]), sample(1, 1, [0, 0, 0])]
    for item, slope in zip(items, (0.02, .2)):
        item['soleRegionWorldM'] = [[0, 0, 0], [.02, 0, .02*slope], [0, .02, 0]]
    result = summarize_contact_phases(items, 24)['fullWeight']
    assert result['patchPlaneFrame'] == 0
    assert [p['frame'] for p in result['planeFrames']] == [0, 1]
    assert result['planeFrames'][0]['planeCorrection']['status'] == 'diagnostic_only'
    assert result['planeFrames'][1]['planeCorrection']['status'] == 'rejected'
    assert result['maxPatchTiltDeg'] == pytest.approx(math.degrees(math.atan(.2)))
