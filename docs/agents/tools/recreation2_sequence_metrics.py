"""Continuous output and source-key metrics for predeclared IK weights.

Loaded only by recreation2_two_bone_ik_probe.py --sequence.  Every candidate
uses the same baseline, fixed patches, support schedule and target plane.
"""
import copy
import json
import math
from pathlib import Path
from types import SimpleNamespace

import bpy
from mathutils import Vector


def quantile(values, p):
    ordered = sorted(values)
    if not ordered:
        return None
    position = (len(ordered) - 1) * p
    lo = int(position)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] * (hi - position) + ordered[hi] * (position - lo) if hi != lo else ordered[lo]


def stats(values):
    return {'count': len(values), 'median': quantile(values, .5),
            'p95': quantile(values, .95), 'max': max(values) if values else None}


def schedule(seconds):
    # Times are source-PTS evidence, shared by all candidates.  Support status
    # is a candidate; transitions are deliberately excluded from slip stats.
    if seconds <= 1.507030:
        return 'l', min(1.0, max(0.0, (1.507030 - seconds) / .15))
    if seconds >= 1.778295:
        return 'r', min(1.0, max(0.0, (seconds - 1.778295) / .15))
    return None, 0.0


def clear_animation(c):
    for obj in (c.arm, c.root):
        if obj.animation_data:
            obj.animation_data_clear()


def run(context):
    c = SimpleNamespace(**context)
    anchors_list = json.loads(Path(c.args.anchors).read_text())
    # The stop/hold key shares source_frame=11: it is not a second independent
    # source observation and must not receive extra weight in error summaries.
    source_keys = [item for item in anchors_list if item.get('kind') != 'hold_until_next_pts']
    assert len(source_keys) == 28
    summaries = {}
    results = {}
    for weight in (0.0, .5, 1.0):
        label = f'weight-{weight:.1f}'
        baked_frames = []
        expected_key_pixels = {}
        requests = []
        for original in c.bundle['frames']:
            c.load_pose(original)
            before_pixels = c.joint_pixels()
            seconds = (original['frame'] - 1) / c.bundle['fps']
            side, blend = schedule(seconds)
            baked = copy.deepcopy(original)
            if side and weight * blend > 0:
                patch = c.patch_center(side)
                request = c.solve(side, c.head(f'ankle_{side}') +
                                  Vector((0, 0, (c.ground_z - patch.z) * weight * blend)))
                request.update(output_frame=original['frame'], side=side, blend=blend)
                requests.append(request)
                for name in (f'upper_leg_{side}', f'lower_leg_{side}', f'ankle_{side}', f'foot_{side}'):
                    q = c.arm.pose.bones[name].rotation_quaternion
                    baked['localQuaternions'][name] = [q.x, q.y, q.z, q.w]
                pixels = c.joint_pixels()
                untouched = [key for key in pixels if not key.startswith('left_' if side == 'l' else 'right_')
                             or key.split('_', 1)[1] in ('shoulder', 'elbow', 'wrist', 'hip')]
                assert max(math.dist(pixels[k], before_pixels[k]) for k in untouched) < .01
            expected_key_pixels[original['frame']] = c.joint_pixels()
            baked_frames.append(baked)
        candidate = dict(c.bundle, frames=baked_frames, request_id='recreation2-sequence-' + label,
                         diagnostic_contact_weight=weight, review_status='diagnostic_pending_contact_calibration')
        (c.out / (label + '.bundle.json')).write_text(json.dumps(candidate, indent=2) + '\n')
        # Real renderer animation, sampled at every output frame.  Reset all
        # quaternions so absent ankle channels do not leak across candidates.
        c.load_pose(c.bundle['frames'][0])
        clear_animation(c)
        c.renderer.apply_bundle(candidate, c.arm)
        output_rows = []
        output_by_frame = {}
        previous = None
        roundtrip = []
        for frame in range(1, 49):
            bpy.context.scene.frame_set(frame)
            c.update()
            pixels = c.joint_pixels()
            patches = {s: list(c.patch_center(s)) for s in ('l', 'r')}
            side, blend = schedule((frame - 1) / c.bundle['fps'])
            stable = side is not None and blend >= .999
            row = {'output_frame': frame, 'output_time_s': (frame - 1) / c.bundle['fps'],
                   'support_side_candidate': side, 'transition_blend': blend,
                   'stable_support_candidate': stable, 'patch_world': patches,
                   'patch_plane_residual_units': {s: patches[s][2] - c.ground_z for s in ('l', 'r')},
                   'support_horizontal_speed_units_per_s': None, 'max_joint_screen_step_px': None}
            if previous:
                row['max_joint_screen_step_px'] = max(math.dist(pixels[k], previous['pixels'][k]) for k in pixels)
                if stable and previous['stable_support_candidate'] and side == previous['support_side_candidate']:
                    row['support_horizontal_speed_units_per_s'] = math.dist(patches[side][:2], previous['patch_world'][side][:2]) * c.bundle['fps']
            if frame in expected_key_pixels:
                roundtrip.append(max(math.dist(pixels[k], expected_key_pixels[frame][k]) for k in pixels))
            output_rows.append(row)
            output_by_frame[frame] = {'pixels': pixels, 'row': row}
            previous = dict(row, pixels=pixels)
        assert max(roundtrip) < .01, (label, max(roundtrip))
        source_rows = []
        for anchor in source_keys:
            source = anchor['source_frame']
            pixels = output_by_frame[anchor['new_bundle_frame']]['pixels']
            error = c.errors(pixels, c.track[source]['semantic_joints'])
            source_rows.append(dict(anchor, **error))
        all_errors = [error for row in source_rows for error in row['per_joint_px'].values()]
        ankle_errors = [error for row in source_rows for name, error in row['per_joint_px'].items() if name.endswith('_ankle')]
        knee_errors = [error for row in source_rows for name, error in row['per_joint_px'].items() if name.endswith('_knee')]
        patch_residuals = [abs(row['patch_plane_residual_units'][row['support_side_candidate']])
                           for row in output_rows if row['stable_support_candidate']]
        speeds = [row['support_horizontal_speed_units_per_s'] for row in output_rows
                  if row['support_horizontal_speed_units_per_s'] is not None]
        summary = {'source_samples': len(source_rows), 'output_frames': len(output_rows),
                   'all_joint_error_px': stats(all_errors),
                   'per_source_mean_error_px': stats([r['mean_px'] for r in source_rows]),
                   'ankle_error_px': stats(ankle_errors), 'knee_error_px': stats(knee_errors),
                   'stable_support_patch_plane_abs_residual_units': stats(patch_residuals),
                   'stable_support_horizontal_speed_units_per_s': stats(speeds),
                   'output_max_joint_screen_step_px': stats([r['max_joint_screen_step_px'] for r in output_rows if r['max_joint_screen_step_px'] is not None]),
                   'unreachable_requests': sum(r['unreachable_distance_units'] > 1e-5 for r in requests),
                   'renderer_roundtrip_max_difference_px': max(roundtrip),
                   'selected_source_mean_error_px': {r['source_frame']: r['mean_px'] for r in source_rows if r['source_frame'] in (1,17,23,29,41,55)}}
        summaries[label] = summary
        results[label] = {'summary': summary, 'requests': requests,
                          'source_observations': source_rows, 'output_metrics': output_rows}
        print(label, json.dumps(summary))
    report = {'schema': 'recreation2-sequence-tolerance.v1', 'rig_sha256': c.report['rig_sha256'],
              'units': c.report['units'], 'ground_proxy_z': c.ground_z,
              'status': 'diagnostic_pending_contact_calibration',
              'source_comparison': '28 sampled source poses; keyframe PTS quantization; hold key not double-counted',
              'output_comparison': '48 renderer frames; animation interpolation only, no invented source truth',
              'percentile_method': 'linear interpolation on sorted observations',
              'acceptance_thresholds': None,
              'weights_fixed_before_run': [0, .5, 1],
              'cases': results}
    (c.out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    (c.out / 'summary.json').write_text(json.dumps(summaries, indent=2) + '\n')
