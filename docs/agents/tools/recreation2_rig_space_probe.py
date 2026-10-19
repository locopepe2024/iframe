"""Blender-only, isolated rig/body/parent-space ablation; no service writes.

Place build_full_body_bundle_blender.py and render_full_motion_bundle.py beside
this file. Source/PTS inputs are the existing recreation2 diagnostic inputs.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer

# Load only definitions, not the builder's command-line entry point.
builder_path = Path(__file__).with_name('build_full_body_bundle_blender.py')
solver = {}
exec(compile(builder_path.read_text().split('raw=sys.argv[')[0], str(builder_path), 'exec'), solver)


def body_frame(right, up):
    if min(right.length, up.length) < 1e-8:
        raise ValueError('degenerate body axis')
    up = up.normalized()
    forward = up.cross(right)
    if forward.length < 1e-8:
        raise ValueError('parallel body axes')
    forward.normalize()
    right = forward.cross(up).normalized()
    return Matrix((right, forward, up)).transposed()


def world_rotation(arm, bone):
    return (arm.matrix_world @ bone.matrix).to_quaternion()


def align_direction(arm, bone, target, own_basis):
    current = solver['wd'](arm, bone)
    delta = current.rotation_difference(target)
    basis = world_rotation(arm, bone) if own_basis else (
        world_rotation(arm, bone.parent) if bone.parent else arm.matrix_world.to_quaternion())
    bone.rotation_quaternion = basis.inverted() @ delta @ basis
    bpy.context.view_layer.update()
    return math.degrees(solver['wd'](arm, bone).angle(target))


def project(point):
    scene = bpy.context.scene
    value = world_to_camera_view(scene, scene.camera, point)
    return [value.x * 640, (1 - value.y) * 360]


def projected_support_y(arm, sides):
    return sum(project(arm.matrix_world @ arm.pose.bones[f'foot_{side}'].head)[1]
               for side in sides) / len(sides)


def pelvis_target_frame(joints, mode):
    right = solver['vec'](joints, 'left_hip', 'right_hip')
    if mode == 'horizontal':
        # Keep pelvic up independent of the shoulder/hip tilt.  The torso
        # vector remains available to the spine channels below.
        return body_frame(right, Vector((0, 0, 1)))
    return body_frame(right, solver['torso'](joints))


parser = argparse.ArgumentParser()
parser.add_argument('--track', required=True)
parser.add_argument('--rig', required=True)
parser.add_argument('--anchors', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--render-selected', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
track = json.loads(Path(args.track).read_text())
anchors = json.loads(Path(args.anchors).read_text())
pts_by_source = {row['source_frame']: row['source_pts_s'] for row in anchors}
source_by_frame = {row['source_frame']: row for row in track['frames']}
bpy.ops.wm.open_mainfile(filepath=args.rig)
arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
if arm.animation_data:
    arm.animation_data_clear()
for bone in arm.pose.bones:
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = (1, 0, 0, 0)
bpy.context.view_layer.update()
rest_pelvis = world_rotation(arm, arm.pose.bones['pelvis'])
head = lambda name: arm.matrix_world @ arm.pose.bones[name].head
rest_body = body_frame(head('upper_leg_r') - head('upper_leg_l'),
                       (head('upper_arm_r') + head('upper_arm_l') -
                        head('upper_leg_r') - head('upper_leg_l')) * .5)
rest_axes = {'pelvis_world': [list(row) for row in rest_pelvis.to_matrix()],
             'body_world': [list(row) for row in rest_body],
             'armature_world': [list(row) for row in arm.matrix_world],
             'pelvis_rest_local': [list(row) for row in arm.data.bones['pelvis'].matrix_local]}
root = bpy.data.objects.new('director-motion-root', None)
bpy.context.collection.objects.link(root)
arm.parent = root
bundle_base = {'schema': 'director-full-motion-bundle.v1', 'fps': 24,
               'frame_range': [1, 48], 'facing_offset_deg': 0,
               'review_status': 'diagnostic_only', 'warnings': ['proxy depth; no contact constraints']}
renderer.setup_scene(bundle_base, out)
parts = {'shoulder': 'upper_arm', 'elbow': 'lower_arm', 'wrist': 'wrist',
         'hip': 'upper_leg', 'knee': 'lower_leg', 'ankle': 'ankle'}
selected = {1, 17, 23, 29, 41, 55}
support_by_source = {1: ('l',), 17: ('l',), 23: ('l',), 29: ('l', 'r'),
                     41: ('l',), 55: ('l',)}
contact_ground_z = 0.159
cases = [('no_pelvis', False, False, False, 'torso', False),
         ('no_pelvis_root', False, False, True, 'torso', False),
         ('no_pelvis_root_contact', False, False, True, 'torso', True),
         ('no_pelvis_root_pixel_contact', False, False, True, 'torso', 'pixel'),
         ('pelvis_horizontal_root', True, True, True, 'horizontal', False),
         ('pelvis_horizontal_root_contact', True, True, True, 'horizontal', True),
         ('pelvis_horizontal_root_pixel_contact', True, True, True, 'horizontal', 'pixel'),
         ('body_own_basis_root', True, True, True, 'torso', False),
         ('no_pelvis_own_basis_root', False, True, True, 'torso', False)]
report = {'rig_sha256': hashlib.sha256(Path(args.rig).read_bytes()).hexdigest(),
          'track_sha256': hashlib.sha256(Path(args.track).read_bytes()).hexdigest(),
          'blender': bpy.app.version_string, 'rest': rest_axes, 'cases': {}}
for label, orient, own_basis, include_root, pelvis_mode, contact in cases:
    frames = []
    rows = []
    previous_yaw = previous_axis = first_yaw = None
    solved = {}
    for src in track['frames']:
        joints = src['semantic_joints']
        yaw, previous_axis = solver['root_yaw'](joints, previous_yaw, previous_axis)
        previous_yaw = yaw
        if first_yaw is None:
            first_yaw = yaw
        root_yaw = yaw - first_yaw
        root.rotation_euler[2] = root_yaw if include_root else 0
        root.location = (0, 0, 0)
        for bone in arm.pose.bones:
            bone.rotation_quaternion = (1, 0, 0, 0)
        bpy.context.view_layer.update()
        pelvis_error = None
        target_body = pelvis_target_frame(joints, pelvis_mode)
        if orient:
            target = (target_body @ rest_body.inverted()).to_quaternion() @ rest_pelvis
            pelvis = arm.pose.bones['pelvis']
            current = world_rotation(arm, pelvis)
            # Left-multiplying the world rotation, conjugated by the current
            # bone basis, yields matrix_basis in this reset pose.
            delta = target @ current.inverted()
            pelvis.rotation_quaternion = current.inverted() @ delta @ current
            bpy.context.view_layer.update()
            pelvis_error = math.degrees(world_rotation(arm, pelvis).rotation_difference(target).angle)
        residuals = {}
        torso = solver['torso'](joints)
        for name in solver['ORDER']:
            bone = arm.pose.bones.get(name)
            if bone is None:
                continue
            rest_direction = solver['wd'](arm, bone)
            if name.startswith('spine_'):
                target = solver['spine_target'](name, torso, rest_direction)
            elif name.startswith('clavicle_'):
                target = solver['clavicle'](joints, name[-1])
            else:
                target = solver['vec'](joints, *solver['PAIRS'][name])
            residuals[name] = align_direction(arm, bone, target, own_basis or name.startswith(('upper_arm_', 'upper_leg_')))
        pelvis_q = solver['qxyzw'](arm.pose.bones['pelvis'].rotation_quaternion) if orient else None
        h = [(joints['left_hip'][i] + joints['right_hip'][i]) / 2 for i in range(3)]
        position = [(h[0] - .5) * 2.4, max(-.35, min(.35, -h[2] * 1.5)), (1 - h[1]) * 1.8 - .9]
        item = {'rootPosition': position, 'rootYaw': root_yaw, 'pelvisQuaternion': pelvis_q,
                'localQuaternions': {name: solver['qxyzw'](arm.pose.bones[name].rotation_quaternion)
                                     for name in solver['ORDER']}, 'footContacts': []}
        solved[src['source_frame']] = item
        # Evaluate exactly the root used by the existing renderer, including
        # for cases whose solve omitted it.
        root.rotation_euler[2] = root_yaw
        root.location = position
        bpy.context.view_layer.update()
        if contact is True and src['source_frame'] in support_by_source:
            support_z = [float((arm.matrix_world @ arm.pose.bones[f'foot_{side}'].head).z)
                         for side in support_by_source[src['source_frame']]]
            root.location.z += contact_ground_z - sum(support_z) / len(support_z)
            bpy.context.view_layer.update()
        elif contact == 'pixel' and src['source_frame'] in support_by_source:
            sides = support_by_source[src['source_frame']]
            target_y = sum(joints[f'{"left" if side == "l" else "right"}_ankle'][1] * 360
                           for side in sides) / len(sides)
            for _ in range(3):
                current_y = projected_support_y(arm, sides)
                probe_z = root.location.z + 0.001
                root.location.z = probe_z
                bpy.context.view_layer.update()
                derivative = (projected_support_y(arm, sides) - current_y) / 0.001
                root.location.z -= 0.001
                if abs(derivative) < 1e-5:
                    break
                root.location.z += max(-0.25, min(0.25, (target_y - current_y) / derivative))
                bpy.context.view_layer.update()
        # Persist any contact-induced root correction into the diagnostic
        # bundle; otherwise renderer round-trip would silently discard it.
        item['rootPosition'] = list(root.location)
        errors = {}
        projections = {}
        for side, suffix in [('left', 'l'), ('right', 'r')]:
            for part, prefix in parts.items():
                name = f'{side}_{part}'
                pixel = project(head(f'{prefix}_{suffix}'))
                source = [joints[name][0] * 640, joints[name][1] * 360]
                errors[name] = math.dist(pixel, source)
                projections[name] = pixel
        feet = {}
        for suffix in ('l', 'r'):
            bone = arm.pose.bones[f'foot_{suffix}']
            feet[suffix] = {'head_world': list(arm.matrix_world @ bone.head),
                            'tail_world': list(arm.matrix_world @ bone.tail)}
        if src['source_frame'] in selected:
            rows.append({'source_frame': src['source_frame'], 'source_pts_s': pts_by_source[src['source_frame']],
                         'pelvis_mode': pelvis_mode, 'contact_constraint': contact,
                         'mean_error_px': sum(errors.values()) / 12,
                         'joint_error_px': errors, 'joint_projection_px': projections,
                         'pelvis_rotation_error_deg_before_render_root': pelvis_error,
                         'target_body_axes': [list(row) for row in target_body],
                         'target_body_determinant': target_body.determinant(),
                         'direction_residual_deg_before_render_root': residuals,
                         'root_yaw_deg': math.degrees(root_yaw), 'feet': feet})
    for anchor in anchors:
        frames.append(dict(solved[anchor['source_frame']], frame=anchor['new_bundle_frame']))
    bundle = dict(bundle_base, frames=frames, request_id='recreation2-' + label)
    (out / (label + '.bundle.json')).write_text(json.dumps(bundle, indent=2) + '\n')
    report['cases'][label] = rows
    print(label, [(row['source_frame'], round(row['mean_error_px'], 2)) for row in rows])
# Independent renderer round trip: this catches a solver that looks correct
# in memory but serializes quaternions in the wrong space or component order.
for label, *_ in cases:
    bpy.ops.wm.open_mainfile(filepath=args.rig)
    arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    if arm.animation_data:
        arm.animation_data_clear()
    root = bpy.data.objects.new('director-motion-root', None)
    bpy.context.collection.objects.link(root)
    arm.parent = root
    bundle = json.loads((out / (label + '.bundle.json')).read_text())
    renderer.setup_scene(bundle, out)
    renderer.apply_bundle(bundle, arm)
    anchor_by_source = {item['source_frame']: item for item in anchors}
    for row in report['cases'][label]:
        bpy.context.scene.frame_set(anchor_by_source[row['source_frame']]['new_bundle_frame'])
        bpy.context.view_layer.update()
        difference = []
        for side, suffix in [('left', 'l'), ('right', 'r')]:
            for part, prefix in parts.items():
                name = f'{side}_{part}'
                difference.append(math.dist(project(head(f'{prefix}_{suffix}')), row['joint_projection_px'][name]))
        row['renderer_roundtrip_max_projection_difference_px'] = max(difference)
        joints = source_by_frame[row['source_frame']]['semantic_joints']
        row['rendered_limb_direction_residual_deg'] = {
            name: math.degrees(solver['wd'](arm, arm.pose.bones[name]).angle(solver['vec'](joints, *pair)))
            for name, pair in solver['PAIRS'].items()}
        if (args.render_selected and label in ('no_pelvis', 'body_own_basis_root', 'no_pelvis_own_basis_root')
                and row['source_frame'] in (1, 23, 29, 55)):
            scene = bpy.context.scene
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(out / f'{label}-source-{row["source_frame"]:03}.png')
            bpy.ops.render.render(write_still=True)
for label, rows in report['cases'].items():
    for row in rows:
        assert abs(row['target_body_determinant'] - 1) < 1e-5, (label, row)
        assert row['renderer_roundtrip_max_projection_difference_px'] < .001, (label, row)
        if 'own_basis' in label:
            assert max(row['direction_residual_deg_before_render_root'].values()) < .1, (label, row)
        if label.endswith('own_basis_root'):
            assert max(row['rendered_limb_direction_residual_deg'].values()) < .1, (label, row)
        if row['pelvis_rotation_error_deg_before_render_root'] is not None:
            assert row['pelvis_rotation_error_deg_before_render_root'] < .1, (label, row)
report['verification'] = 'right_handed_axes_direction_alignment_and_renderer_roundtrip_passed'
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
