"""Source Z contribution ablation; frozen camera mapping, root, rig and PTS."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer

builder = Path(__file__).with_name('build_full_body_bundle_blender.py')
solver = {}
exec(compile(builder.read_text().split('raw=sys.argv[')[0], str(builder), 'exec'), solver)
parser = argparse.ArgumentParser()
for key in ('track', 'rig', 'anchors', 'baseline', 'patches', 'out'):
    parser.add_argument('--' + key, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
track = json.loads(Path(args.track).read_text())
anchors = json.loads(Path(args.anchors).read_text())
baseline = json.loads(Path(args.baseline).read_text())
patches = json.loads(Path(args.patches).read_text())['patch_vertex_ids']
parts = {'shoulder': 'upper_arm', 'elbow': 'lower_arm', 'wrist': 'wrist',
         'hip': 'upper_leg', 'knee': 'lower_leg', 'ankle': 'ankle'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stats(values):
    values = sorted(values)
    def q(p):
        position = (len(values) - 1) * p
        lo, hi = math.floor(position), math.ceil(position)
        return values[lo] + (values[hi] - values[lo]) * (position - lo)
    return {'count': len(values), 'median': q(.5), 'p95': q(.95), 'max': values[-1]}


def update():
    bpy.context.view_layer.update()


def pixels():
    scene = bpy.context.scene
    result = {}
    for side, suffix in [('left', 'l'), ('right', 'r')]:
        for part, prefix in parts.items():
            point = arm.matrix_world @ arm.pose.bones[f'{prefix}_{suffix}'].head
            ndc = world_to_camera_view(scene, scene.camera, point)
            result[f'{side}_{part}'] = [ndc.x * 640, (1 - ndc.y) * 360]
    return result


def patch_centers():
    mesh = bpy.data.objects['white-model-neutral-female-03']
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    result = {side: list(sum((evaluated.matrix_world @ data.vertices[i].co for i in ids), Vector()) / len(ids))
              for side, ids in patches.items()}
    evaluated.to_mesh_clear()
    return result


def setup():
    bpy.ops.wm.open_mainfile(filepath=args.rig)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    if arm.animation_data:
        arm.animation_data_clear()
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
    root = bpy.data.objects.new('director-motion-root', None)
    bpy.context.collection.objects.link(root)
    arm.parent = root
    renderer.setup_scene(baseline, out)
    update()
    return arm, root


report = {'schema': 'recreation2-depth-influence.v1', 'blender': bpy.app.version_string,
          'sha256': {key: digest(getattr(args, key)) for key in ('track', 'rig', 'anchors', 'baseline', 'patches')},
          'builder_sha256': digest(builder), 'renderer_sha256': digest(renderer.__file__),
          'probe_sha256': digest(__file__),
          'units': '640x360 image pixels; Blender world units, metric scale unverified',
          'limits': ['No recovered floor or physical contact truth', 'No source depth accuracy test',
                     'Camera axes, Y scale, own basis, root/yaw and pelvis/IK frozen; Z weights diagnostic only'], 'cases': {}}
world_basis = solver['BASIS'].copy()
for label, depth_weight in [('z_full', 1.0), ('z_half', .5), ('z_zero', 0.0)]:
    factor, mapping = 792/1394, 'camera'
    own_basis = True
    arm, root = setup()
    if mapping == 'world':
        solver['BASIS'] = world_basis.copy()
    else:
        rotation = bpy.context.scene.camera.matrix_world.to_quaternion()
        axes = [rotation @ Vector(v) for v in ((1,0,0),(0,-1,0),(0,0,-1))]
        matrix = Matrix(axes).transposed()
        assert abs(matrix.determinant()-1) < 1e-5
        solver['BASIS'] = matrix.to_quaternion()
    solved, solved_pixels = {}, {}
    previous_yaw = previous_axis = first_yaw = None
    for src in track['frames']:
        original = src['semantic_joints']
        # Original data controls root and scoring. Only direction targets change.
        joints = {name: [v[0], v[1] * factor, v[2] * depth_weight] for name, v in original.items()}
        yaw, previous_axis = solver['root_yaw'](original, previous_yaw, previous_axis)
        previous_yaw = yaw
        first_yaw = yaw if first_yaw is None else first_yaw
        root.rotation_euler[2] = yaw - first_yaw
        root.location = (0, 0, 0)
        for bone in arm.pose.bones:
            bone.rotation_quaternion = (1, 0, 0, 0)
        update()
        torso = solver['torso'](joints)
        for name in solver['ORDER']:
            bone = arm.pose.bones[name]
            if name.startswith('spine_'):
                target = solver['spine_target'](name, torso, solver['wd'](arm, bone))
            elif name.startswith('clavicle_'):
                target = solver['clavicle'](joints, name[-1])
            else:
                target = solver['vec'](joints, *solver['PAIRS'][name])
            delta = solver['wd'](arm, bone).rotation_difference(target)
            reference = bone if (own_basis or name.startswith(('upper_arm_', 'upper_leg_'))) else bone.parent
            basis = (arm.matrix_world @ reference.matrix).to_quaternion() if reference else arm.matrix_world.to_quaternion()
            bone.rotation_quaternion = basis.inverted() @ delta @ basis
            update()
        h = [(original['left_hip'][i] + original['right_hip'][i]) / 2 for i in range(3)]
        position = [(h[0] - .5) * 2.4, max(-.35, min(.35, -h[2] * 1.5)), (1 - h[1]) * 1.8 - .9]
        item = {'rootPosition': position, 'rootYaw': yaw - first_yaw, 'pelvisQuaternion': None,
                'localQuaternions': {name: solver['qxyzw'](arm.pose.bones[name].rotation_quaternion) for name in solver['ORDER']},
                'footContacts': []}
        root.location = position
        update()
        # Existing probe serializes Blender's stored float precision.
        item['rootPosition'] = list(root.location)
        solved[src['source_frame']] = item
        solved_pixels[src['source_frame']] = pixels()
    frames = [dict(solved[a['source_frame']], frame=a['new_bundle_frame']) for a in anchors]
    if label == 'z_full':
        for old, new in zip(baseline['frames'], frames, strict=True):
            for key in ('frame', 'rootPosition', 'rootYaw', 'pelvisQuaternion', 'localQuaternions'):
                assert old[key] == new[key], ('baseline mismatch', key, old['frame'])
        report['baseline_channels_exact_match'] = True
        raw_frames = frames
    else:
        assert all((f['frame'], f['rootPosition'], f['rootYaw']) ==
                   (r['frame'], r['rootPosition'], r['rootYaw']) for f, r in zip(frames, raw_frames, strict=True))
        report['candidate_root_and_keys_exact_match'] = True
    bundle = dict(baseline, frames=frames, request_id='recreation2-depth-influence-' + label,
                  review_status='diagnostic_only', diagnostic_direction_y_scale=factor, diagnostic_mapping=mapping, diagnostic_depth_weight=depth_weight)
    (out / (label + '.bundle.json')).write_text(json.dumps(bundle, indent=2) + '\n')
    arm, root = setup()
    renderer.apply_bundle(bundle, arm)
    output_rows = []
    for frame in range(1, 49):
        bpy.context.scene.frame_set(frame)
        update()
        current = {'output_frame': frame, 'pixels': pixels(), 'patch_world': patch_centers()}
        if output_rows:
            old = output_rows[-1]
            current['joint_steps_px'] = {k: math.dist(v, old['pixels'][k]) for k, v in current['pixels'].items()}
            current['patch_horizontal_speed_units_per_s'] = {
                s: math.dist(v[:2], old['patch_world'][s][:2]) * 24 for s, v in current['patch_world'].items()}
        output_rows.append(current)
    observations, roundtrip = [], []
    track_by_source = {s['source_frame']: s['semantic_joints'] for s in track['frames']}
    for anchor in anchors:
        rendered = output_rows[anchor['new_bundle_frame'] - 1]['pixels']
        expected = solved_pixels[anchor['source_frame']]
        roundtrip.append(max(math.dist(rendered[k], expected[k]) for k in expected))
        if anchor.get('kind') == 'hold_until_next_pts':
            continue
        source = track_by_source[anchor['source_frame']]
        errors = {k: math.dist(v, [source[k][0] * 640, source[k][1] * 360]) for k, v in rendered.items()}
        segments = {}
        for side in ('left', 'right'):
            for start, end in [('shoulder','elbow'), ('elbow','wrist'), ('hip','knee'), ('knee','ankle')]:
                key_a, key_b = f'{side}_{start}', f'{side}_{end}'
                actual = Vector(rendered[key_b])-Vector(rendered[key_a])
                expected = Vector(((source[key_b][0]-source[key_a][0])*640, (source[key_b][1]-source[key_a][1])*360))
                assert expected.length > 1e-6 and actual.length > 1e-6
                segments[f'{side}_{start}_{end}'] = {
                    'source_length_px': expected.length, 'rig_length_px': actual.length,
                    'length_ratio': actual.length/expected.length,
                    'absolute_length_error_px': abs(actual.length-expected.length),
                    'direction_error_deg': math.degrees(math.acos(max(-1,min(1,actual.normalized().dot(expected.normalized())))))}
        observations.append(dict(anchor, mean_px=sum(errors.values()) / 12, per_joint_px=errors, segments=segments))
    assert max(roundtrip) < .01, (label, max(roundtrip))
    assert len(observations) == 28
    summary = {'depth_weight': depth_weight, 'mapping': mapping, 'direction_y_scale': factor, 'rotation_basis': 'own_bone' if own_basis else 'mixed_parent_and_own',
               'all_joint_error_px': stats([e for row in observations for e in row['per_joint_px'].values()]),
               'ankle_error_px': stats([e for row in observations for k, e in row['per_joint_px'].items() if k.endswith('_ankle')]),
               'selected_source_mean_px': {r['source_frame']: r['mean_px'] for r in observations if r['source_frame'] in (1, 17, 23, 29, 41, 55)},
               'projected_segment_length_abs_error_px': stats([seg['absolute_length_error_px'] for row in observations for seg in row['segments'].values()]),
               'projected_segment_direction_error_deg': stats([seg['direction_error_deg'] for row in observations for seg in row['segments'].values()]),
               'segment_groups': {group: {metric: stats([seg[metric] for row in observations for name,seg in row['segments'].items() if name.endswith(group)]) for metric in ('length_ratio','absolute_length_error_px','direction_error_deg')} for group in ('shoulder_elbow','elbow_wrist','hip_knee','knee_ankle')},
               'renderer_roundtrip_max_px': max(roundtrip),
               'output_max_joint_step_px': stats([max(r['joint_steps_px'].values()) for r in output_rows[1:]]),
               'patch_horizontal_speed_units_per_s': {s: stats([r['patch_horizontal_speed_units_per_s'][s] for r in output_rows[1:]]) for s in ('l', 'r')},
               'spikes': [r for r in output_rows if r['output_frame'] in (28, 33)]}
    report['cases'][label] = {'summary': summary, 'source_observations': observations, 'output': output_rows}
    print(label, json.dumps(summary))
assert report['sha256']['track'] == digest(args.track)
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
(out / 'summary.json').write_text(json.dumps({
    'schema': report['schema'], 'sha256': report['sha256'], 'blender': report['blender'],
    'baseline_channels_exact_match': report['baseline_channels_exact_match'],
    'candidate_root_and_keys_exact_match': report['candidate_root_and_keys_exact_match'],
    'depth_weight_cases': list(report['cases']),
    'cases': {k: v['summary'] for k, v in report['cases'].items()}}, indent=2) + '\n')
print('DEPTH_INFLUENCE_PROBE_COMPLETE')
