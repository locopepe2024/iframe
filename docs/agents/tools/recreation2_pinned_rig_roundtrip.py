"""Isolated pinned-Blender-rig known-pose inverse/FK and renderer roundtrip."""
import argparse
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


def matrix_gap(a, b):
    return max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4))


def side_world(arm, bone):
    return arm.matrix_world @ bone.matrix @ Vector((0.07, 0.13, 0.04))


def screen(point):
    uv = world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, point)
    return Vector((uv.x * 640, (1 - uv.y) * 360))


def reset_pose(arm):
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion((1, 0, 0, 0))
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def setup(rig, bundle, out):
    bpy.ops.wm.open_mainfile(filepath=str(rig))
    arm = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    driver_count = sum(len(data.animation_data.drivers)
                       for data in (arm, arm.data) if data.animation_data)
    if driver_count:
        raise RuntimeError('rig object/data drivers need separate closed-loop handling')
    if arm.animation_data:
        arm.animation_data_clear()
    root = bpy.data.objects.new('director-motion-root', None)
    bpy.context.collection.objects.link(root)
    arm.parent = root
    renderer.setup_scene(bundle, out)
    reset_pose(arm)
    return arm, root, driver_count


def quat_xyzw(q):
    return [q.x, q.y, q.z, q.w]


def max_error(actual, expected):
    row = {'world_matrix': 0., 'head_m': 0., 'tail_m': 0.,
           'side_m': 0., 'side_px': 0., 'worst_bone': None}
    for name, target in expected.items():
        bone = actual.pose.bones[name]
        world = actual.matrix_world @ bone.matrix
        values = {
            'world_matrix': matrix_gap(world, target),
            'head_m': ((actual.matrix_world @ bone.head) - target.translation).length,
            'tail_m': ((actual.matrix_world @ bone.tail) -
                       (target @ Vector((0, bone.bone.length, 0)))).length,
            'side_m': (side_world(actual, bone) -
                       (target @ Vector((0.07, 0.13, 0.04)))).length,
            'side_px': (screen(side_world(actual, bone)) -
                        screen(target @ Vector((0.07, 0.13, 0.04)))).length,
        }
        for key, value in values.items():
            if value > row[key]:
                row[key] = value
                row['worst_bone'] = name if key == 'world_matrix' else row['worst_bone']
    return row


def main():
    ap = argparse.ArgumentParser()
    for key in ('rig', 'bundle', 'anchors', 'out'):
        ap.add_argument('--' + key, required=True)
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
    rig, path = Path(args.rig), Path(args.bundle)
    baseline = json.loads(path.read_text())
    anchors = json.loads(Path(args.anchors).read_text())
    frame_by_number = {f['frame']: f for f in baseline['frames']}
    selected = [a for a in anchors if a['source_frame'] in (1, 17, 23, 29, 55)]
    assert [a['source_frame'] for a in selected] == [1, 17, 23, 29, 55]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    arm, root, driver_count = setup(rig, baseline, out)
    order = sorted(arm.pose.bones, key=lambda b: len(b.parent_recursive))
    assert {'pelvis', 'spine_chest', 'foot_l', 'foot_r'} <= set(arm.pose.bones.keys())
    inventory = {
        'bone_count': len(order),
        'constraint_count': sum(len(b.constraints) for b in order),
        'rig_object_data_driver_count': driver_count,
        'inherit_scale': {b.name: b.bone.inherit_scale for b in order},
        'use_inherit_rotation_false': [b.name for b in order if not b.bone.use_inherit_rotation],
        'use_local_location_false': [b.name for b in order if not b.bone.use_local_location],
        'armature_object_matrix': [list(row) for row in arm.matrix_world],
    }
    rows, expected_by_frame, serialized = [], {}, []
    for anchor in selected:
        source_frame, frame = anchor['source_frame'], anchor['new_bundle_frame']
        item = frame_by_number[frame]
        root.rotation_euler[2] = item['rootYaw'] + math.radians(13)
        root.location = item['rootPosition']
        reset_pose(arm)
        quats = dict(item.get('localQuaternions') or {})
        if item.get('pelvisQuaternion'):
            quats['pelvis'] = item['pelvisQuaternion']
        for name, xyzw in quats.items():
            arm.pose.bones[name].rotation_quaternion = Quaternion((xyzw[3], *xyzw[:3]))
        arm.pose.bones['pelvis'].rotation_quaternion @= Quaternion((0, 0, 1), math.radians(11))
        arm.pose.bones['spine_chest'].rotation_quaternion @= Quaternion((0, 1, 0), math.radians(35))
        bpy.context.view_layer.update()
        target = {b.name: (arm.matrix_world @ b.matrix).copy() for b in order}
        expected_by_frame[frame] = target
        reset_pose(arm)
        translations, scales = 0., 0.
        for bone in order:
            target_arm = arm.matrix_world.inverted() @ target[bone.name]
            options = {'invert': True}
            if bone.parent:
                options.update(parent_matrix=bone.parent.matrix,
                               parent_matrix_local=bone.parent.bone.matrix_local)
            basis = bone.bone.convert_local_to_pose(
                target_arm, bone.bone.matrix_local, **options)
            bone.matrix_basis = basis
            bpy.context.view_layer.update()
            translations = max(translations, basis.translation.length)
            scales = max(scales, max(abs(v - 1) for v in basis.to_scale()))
        error = max_error(arm, target)
        chest = arm.pose.bones['spine_chest']
        chest_basis = chest.matrix_basis.copy()
        before_direction = ((arm.matrix_world @ chest.tail) -
                            (arm.matrix_world @ chest.head)).normalized()
        before_side = side_world(arm, chest)
        chest.rotation_quaternion @= Quaternion((0, 1, 0), math.radians(60))
        bpy.context.view_layer.update()
        after_direction = ((arm.matrix_world @ chest.tail) -
                           (arm.matrix_world @ chest.head)).normalized()
        twist = {'bone_direction_deg': math.degrees(before_direction.angle(after_direction)),
                 'side_offset_m': (side_world(arm, chest) - before_side).length}
        chest.matrix_basis = chest_basis
        bpy.context.view_layer.update()
        target_arm = arm.matrix_world.inverted() @ target['spine_chest']
        chest.matrix_basis = chest.parent.matrix.inverted() @ target_arm
        bpy.context.view_layer.update()
        no_rest_error = matrix_gap(arm.matrix_world @ chest.matrix, target['spine_chest'])
        chest.matrix_basis = chest_basis
        bpy.context.view_layer.update()
        root_yaw = root.rotation_euler[2]
        root.rotation_euler[2] = 0
        bpy.context.view_layer.update()
        no_root_error = matrix_gap(arm.matrix_world @ chest.matrix, target['spine_chest'])
        root.rotation_euler[2] = root_yaw
        bpy.context.view_layer.update()
        restored_error = max_error(arm, target)
        print('FRAME_DIAGNOSTIC', source_frame, 'initial', error,
              'restored', restored_error, 'basis', translations, scales,
              'negative', no_rest_error, no_root_error, flush=True)
        assert restored_error['world_matrix'] < 1e-5
        serialized.append({'frame': frame, 'rootYaw': root_yaw,
                           'rootPosition': list(root.location),
                           'localQuaternions': {b.name: quat_xyzw(b.rotation_quaternion)
                                                for b in order}, 'pelvisQuaternion': None})
        rows.append({'source_frame': source_frame, 'source_pts_s': anchor['source_pts_s'],
                     'new_bundle_frame': frame, 'inverse_fk_error': error,
                     'max_basis_translation_m': translations, 'max_basis_scale_deviation': scales,
                     'twist_control': twist, 'omit_rest_world_matrix_error': no_rest_error,
                     'omit_root_world_matrix_error': no_root_error})
    assert all(row['inverse_fk_error']['world_matrix'] < 1e-5 and
               row['inverse_fk_error']['side_px'] < .01 for row in rows)
    assert all(row['max_basis_translation_m'] < 1e-5 and
               row['max_basis_scale_deviation'] < 1e-5 for row in rows)
    assert all(row['omit_rest_world_matrix_error'] > 0.01 and
               row['omit_root_world_matrix_error'] > 0.01 for row in rows)
    assert all(row['twist_control']['bone_direction_deg'] < 1e-4 and
               row['twist_control']['side_offset_m'] > 0.01 for row in rows)
    diagnostic_bundle = {**baseline, 'frames': serialized, 'frame_range': [1, max(f['frame'] for f in serialized)]}
    arm, root, repeat_driver_count = setup(rig, diagnostic_bundle, out)
    assert repeat_driver_count == driver_count
    renderer.apply_bundle(diagnostic_bundle, arm)
    for row in rows:
        bpy.context.scene.frame_set(row['new_bundle_frame'])
        bpy.context.view_layer.update()
        row['renderer_roundtrip_error'] = max_error(arm, expected_by_frame[row['new_bundle_frame']])
        assert row['renderer_roundtrip_error']['world_matrix'] < 1e-5
        assert row['renderer_roundtrip_error']['side_px'] < .01
    report = {'schema': 'recreation2-pinned-rig-roundtrip.v1',
              'rig_sha256': hashlib.sha256(rig.read_bytes()).hexdigest(),
              'bundle_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'blender': bpy.app.version_string, 'inventory': inventory, 'rows': rows,
              'limits': ['Known rig forward poses are synthetic truth, not source video truth',
                         'Twist/pelvis/root perturbations are test stimuli, not source estimates',
                         'Sole mesh and real ground contact not assessed']}
    (out / 'pinned-rig-roundtrip.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PINNED_RIG_ROUNDTRIP_PASS', json.dumps({
        'frames': [r['source_frame'] for r in rows], 'bone_count': len(order),
        'worst_matrix': max(r['inverse_fk_error']['world_matrix'] for r in rows),
        'worst_renderer_px': max(r['renderer_roundtrip_error']['side_px'] for r in rows)}))


if __name__ == '__main__':
    main()
