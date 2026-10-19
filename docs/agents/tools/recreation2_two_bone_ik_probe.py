"""Isolated analytic hip/knee/ankle IK with fixed skinned sole vertex IDs."""
import argparse
import copy
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer


def update():
    bpy.context.view_layer.update()


def head(name):
    return arm.matrix_world @ arm.pose.bones[name].head


def rotation(name):
    return (arm.matrix_world @ arm.pose.bones[name].matrix).to_quaternion()


def rotate_world(name, delta):
    bone = arm.pose.bones[name]
    current = rotation(name)
    bone.rotation_quaternion = bone.rotation_quaternion @ current.inverted() @ delta @ current
    update()


def aim(name, direction):
    bone = arm.pose.bones[name]
    current = arm.matrix_world.to_3x3() @ (bone.tail - bone.head)
    rotate_world(name, current.rotation_difference(direction))


def vertex_positions():
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = evaluated.to_mesh()
    positions = [evaluated.matrix_world @ v.co for v in data.vertices]
    evaluated.to_mesh_clear()
    return positions


def patch_center(side):
    positions = vertex_positions()
    return sum((positions[i] for i in patches[side]), Vector()) / len(patches[side])


def project(point):
    ndc = world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, point)
    return [ndc.x * 640, (1 - ndc.y) * 360]


def joint_pixels():
    return {f'{side}_{part}': project(head(f'{prefix}_{suffix}'))
            for side, suffix in [('left', 'l'), ('right', 'r')]
            for part, prefix in PARTS.items()}


def errors(pixels, joints):
    result = {key: math.dist(value, [joints[key][0] * 640, joints[key][1] * 360])
              for key, value in pixels.items()}
    return {'mean_px': sum(result.values()) / len(result), 'per_joint_px': result}


def load_pose(frame):
    # No previous animation/constraint is allowed to leak into this sample.
    if arm.animation_data:
        arm.animation_data_clear()
    if root.animation_data:
        root.animation_data_clear()
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion()
    renderer.apply_bundle(dict(bundle, frames=[frame]), arm)
    bpy.context.scene.frame_set(frame['frame'])
    update()


def solve(side, requested):
    upper, lower = f'upper_leg_{side}', f'lower_leg_{side}'
    ankle, foot = f'ankle_{side}', f'foot_{side}'
    hip, knee, old_end = head(upper), head(lower), head(ankle)
    length_a, length_b = (knee - hip).length, (old_end - knee).length
    axis = requested - hip
    distance = axis.length
    if distance < 1e-8:
        raise ValueError('target coincides with hip')
    axis.normalize()
    reachable_distance = min(length_a + length_b - 1e-7,
                             max(abs(length_a - length_b) + 1e-7, distance))
    end = hip + axis * reachable_distance
    pole = knee - hip - axis * (knee - hip).dot(axis)
    if pole.length < 1e-7:
        raise ValueError('ambiguous straight-leg pole; no implicit fallback')
    pole.normalize()
    along = (length_a**2 - length_b**2 + reachable_distance**2) / (2 * reachable_distance)
    bend = math.sqrt(max(0, length_a**2 - along**2))
    target_knee = hip + axis * along + pole * bend
    ankle_rotation, foot_rotation = rotation(ankle), rotation(foot)
    aim(upper, target_knee - hip)
    aim(lower, end - head(lower))
    rotate_world(ankle, ankle_rotation @ rotation(ankle).inverted())
    rotate_world(foot, foot_rotation @ rotation(foot).inverted())
    endpoint_error = (head(ankle) - end).length
    length_errors = [abs((head(lower) - head(upper)).length - length_a),
                     abs((head(ankle) - head(lower)).length - length_b)]
    assert endpoint_error < 1e-4, endpoint_error
    assert max(length_errors) < 1e-5, length_errors
    return {'requested_ankle_world': list(requested), 'reachable_ankle_world': list(end),
            'unreachable_distance_units': abs(distance - reachable_distance),
            'endpoint_error_units': endpoint_error, 'bone_length_errors_units': length_errors}


parser = argparse.ArgumentParser()
for name in ('rig', 'bundle', 'track', 'anchors', 'out'):
    parser.add_argument('--' + name, required=True)
parser.add_argument('--render', action='store_true')
parser.add_argument('--sequence', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
bundle = json.loads(Path(args.bundle).read_text())
track = {f['source_frame']: f for f in json.loads(Path(args.track).read_text())['frames']}
anchors = {f['source_frame']: f for f in json.loads(Path(args.anchors).read_text())}
by_output = {f['frame']: f for f in bundle['frames']}
PARTS = {'shoulder': 'upper_arm', 'elbow': 'lower_arm', 'wrist': 'wrist',
         'hip': 'upper_leg', 'knee': 'lower_leg', 'ankle': 'ankle'}
bpy.ops.wm.open_mainfile(filepath=args.rig)
arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
mesh = bpy.data.objects['white-model-neutral-female-03']
if arm.animation_data:
    arm.animation_data_clear()
for bone in arm.pose.bones:
    if bone.constraints:
        raise ValueError('source rig has constraints: ' + bone.name)
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = Quaternion()
update()
positions = vertex_positions()
patches = {}
for side in ('l', 'r'):
    groups = {g.index for g in mesh.vertex_groups if g.name in
              {f'DEF_foot_{side}', f'toe_{side}', f'toe_attachment_{side}'}}
    candidates = [v.index for v in mesh.data.vertices
                  if max((g.weight for g in v.groups if g.group in groups), default=0) >= .2]
    minimum = min(positions[i].z for i in candidates)
    patches[side] = [i for i in candidates if positions[i].z <= minimum + .008]
root = bpy.data.objects.new('director-motion-root', None)
bpy.context.collection.objects.link(root)
arm.parent = root
renderer.setup_scene(bundle, out)
load_pose(by_output[1])
ground_z = patch_center('l').z
report = {'schema': 'recreation2-two-bone-ik.v1', 'units': 'Blender units; metric scale unverified',
          'rig_sha256': hashlib.sha256(Path(args.rig).read_bytes()).hexdigest(),
          'patch_vertex_ids': patches, 'ground_proxy_z': ground_z,
          'ground_definition': 'first-frame left fixed-patch centroid; not recovered source floor',
          'frames': []}
if args.sequence:
    from recreation2_sequence_metrics import run
    run(globals())
    raise SystemExit(0)
for source, side in [(1, 'l'), (17, 'l'), (23, 'l'), (29, 'l'), (41, 'l'), (55, 'r')]:
    fd = by_output[anchors[source]['new_bundle_frame']]
    load_pose(fd)
    pixels_before = joint_pixels()
    before = patch_center(side)
    # Zero-target regression: both joints and the fixed sole patch must stay.
    zero = solve(side, head(f'ankle_{side}').copy())
    zero_pixels = joint_pixels()
    zero_change = max(math.dist(zero_pixels[k], v) for k, v in pixels_before.items())
    assert zero_change < .01, zero_change
    load_pose(fd)
    result = solve(side, head(f'ankle_{side}') + Vector((0, 0, ground_z - before.z)))
    after = patch_center(side)
    pixels_after = joint_pixels()
    unchanged_keys = [key for key in pixels_before
                      if not key.startswith('left_' if side == 'l' else 'right_')
                      or key.split('_', 1)[1] in ('shoulder', 'elbow', 'wrist', 'hip')]
    unchanged_error = max(math.dist(pixels_after[k], pixels_before[k]) for k in unchanged_keys)
    assert unchanged_error < .01, unchanged_error
    baked = copy.deepcopy(fd)
    baked['localQuaternions'] = dict(baked['localQuaternions'])
    for name in [f'upper_leg_{side}', f'lower_leg_{side}', f'ankle_{side}', f'foot_{side}']:
        q = arm.pose.bones[name].rotation_quaternion
        baked['localQuaternions'][name] = [q.x, q.y, q.z, q.w]
    load_pose(baked)
    roundtrip_pixels = joint_pixels()
    difference = max(math.dist(roundtrip_pixels[k], v) for k, v in pixels_after.items())
    assert difference < .01, difference
    row = dict(result, source_frame=source, source_pts_s=anchors[source]['source_pts_s'],
               output_frame=fd['frame'], support_side_candidate=side,
               zero_target_max_projection_change_px=zero_change,
               unchanged_upper_body_and_other_leg_max_difference_px=unchanged_error,
               before=errors(pixels_before, track[source]['semantic_joints']),
               after=errors(pixels_after, track[source]['semantic_joints']),
               patch_z_before=before.z, patch_z_after=after.z,
               patch_target_residual_units=after.z - ground_z,
               renderer_roundtrip_max_projection_difference_px=difference)
    report['frames'].append(row)
    (out / f'source-{source:03}.bundle.json').write_text(json.dumps(dict(bundle, frames=[baked]), indent=2))
    if args.render:
        for case, pose in [('before', fd), ('after', baked)]:
            load_pose(pose)
            scene = bpy.context.scene
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(out / f'source-{source:03}-{case}.png')
            bpy.ops.render.render(write_still=True)
    print(source, side, row['before']['mean_px'], row['after']['mean_px'], row['patch_target_residual_units'])
report['verification'] = 'zero_target_endpoint_bone_lengths_and_renderer_roundtrip_passed'
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
