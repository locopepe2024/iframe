"""Evaluate frozen bundles; audit world BASIS versus camera projection."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer
solver = {}
builder = Path(__file__).with_name('build_full_body_bundle_blender.py')
exec(compile(builder.read_text().split('raw=sys.argv[')[0], str(builder), 'exec'), solver)
p = argparse.ArgumentParser()
for k in ('rig', 'track', 'anchors', 'bundles', 'out'):
    p.add_argument('--' + k, required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
track = {f['source_frame']: f['semantic_joints'] for f in json.loads(Path(a.track).read_text())['frames']}
anchors = {f['source_frame']: f['new_bundle_frame'] for f in json.loads(Path(a.anchors).read_text()) if f.get('kind') != 'hold_until_next_pts'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def project(v):
    q = world_to_camera_view(bpy.context.scene, bpy.context.scene.camera, v)
    return Vector((q.x * 640, (1 - q.y) * 360))


def angle(u, v):
    return math.degrees(math.acos(max(-1, min(1, u.normalized().dot(v.normalized())))))


report = {'schema': 'recreation2-camera-basis.v1', 'blender': bpy.app.version_string,
          'sha256': {k: digest(v) for k, v in [('rig', a.rig), ('track', a.track), ('anchors', a.anchors), ('probe', __file__), ('builder', builder), ('renderer', renderer.__file__)]},
          'basis_matrix': [list(row) for row in solver['BASIS'].to_matrix()],
          'limits': ['Candidate camera directions are diagnostic only', 'No source depth or camera truth', 'No new bundle/pose optimization'], 'cases': {}}
for label, factor in [('raw_root_yaw', 1), ('scaled_root_yaw', 792/1394), ('raw_own_root_yaw', 1), ('scaled_own_root_yaw', 792/1394)]:
    path = Path(a.bundles) / (label + '.bundle.json')
    bundle = json.loads(path.read_text())
    bpy.ops.wm.open_mainfile(filepath=a.rig)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    if arm.animation_data:
        arm.animation_data_clear()
    for bone in arm.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1, 0, 0, 0)
    root = bpy.data.objects.new('director-motion-root', None)
    bpy.context.collection.objects.link(root)
    arm.parent = root
    renderer.setup_scene(bundle, Path(a.out).parent)
    renderer.apply_bundle(bundle, arm)
    rows = []
    for source in (1, 17, 23, 29, 41, 55):
        bpy.context.scene.frame_set(anchors[source])
        bpy.context.view_layer.update()
        cam = bpy.context.scene.camera
        rotation = cam.matrix_world.to_quaternion()
        right = rotation @ Vector((1, 0, 0))
        up = rotation @ Vector((0, 1, 0))
        forward = rotation @ Vector((0, 0, -1))
        camera = {'type': cam.data.type, 'location': list(cam.matrix_world.translation),
                  'right_world': list(right), 'up_world': list(up), 'forward_world': list(forward),
                  'lens_mm': cam.data.lens, 'sensor_width_mm': cam.data.sensor_width,
                  'sensor_fit': cam.data.sensor_fit, 'pixel_aspect': [bpy.context.scene.render.pixel_aspect_x, bpy.context.scene.render.pixel_aspect_y]}
        if 'camera' not in report:
            report['camera'] = camera
        else:
            assert camera == report['camera']
        original = track[source]
        joints = {k: [v[0], v[1]*factor, v[2]] for k, v in original.items()}
        for side, suffix in [('left', 'l'), ('right', 'r')]:
            for bone_name, start_name, end_name in [('upper_arm', 'shoulder', 'elbow'), ('lower_arm', 'elbow', 'wrist'), ('upper_leg', 'hip', 'knee'), ('lower_leg', 'knee', 'ankle')]:
                bone = arm.pose.bones[f'{bone_name}_{suffix}']
                start, tail = arm.matrix_world @ bone.head, arm.matrix_world @ bone.tail
                length = (tail-start).length
                target = solver['vec'](joints, f'{side}_{start_name}', f'{side}_{end_name}')
                raw_delta = Vector(original[f'{side}_{end_name}'])-Vector(original[f'{side}_{start_name}'])
                source2 = Vector((raw_delta.x*640, raw_delta.y*360))
                existing_screen = project(start+target*length)-project(start)
                # Same scaled inputs, expressed in evaluated camera axes.
                delta = Vector(joints[f'{side}_{end_name}'])-Vector(joints[f'{side}_{start_name}'])
                camera_target = (right*delta.x-up*delta.y+forward*delta.z).normalized()
                camera_screen = project(start+camera_target*length)-project(start)
                # Proper source-pixel aspect uses 360/640, unlike 792/1394.
                pixel_target = (right*raw_delta.x-up*raw_delta.y*(360/640)+forward*raw_delta.z).normalized()
                pixel_screen = project(start+pixel_target*length)-project(start)
                eps = 1e-4
                jac = [(project(start+Vector(axis)*eps)-project(start-Vector(axis)*eps))/(2*eps)
                       for axis in ((1,0,0),(0,1,0),(0,0,1))]
                local = sum((jac[i]*target[i] for i in range(3)), Vector((0,0)))
                tangent = (project(start+target*eps)-project(start-target*eps))/(2*eps)
                assert (local-tangent).length < 1.5, (local, tangent)
                rows.append({'source_frame': source, 'side': side, 'bone': bone.name,
                    'source_delta_xyz': list(raw_delta), 'source_vector_px': list(source2),
                    'start_world': list(start), 'world_bone_length': length,
                    'actual_world_direction_error_deg': angle(tail-start,target),
                    'current_target_world': list(target), 'current_target_camera_components': [target.dot(right), target.dot(up), target.dot(forward)],
                    'jacobian_px_per_world_unit': [list(v) for v in jac],
                    'jacobian_direction_consistency_deg': angle(local,tangent),
                    'current_projected_vector_px': list(existing_screen),
                    'current_screen_angle_deg': angle(existing_screen,source2),
                    'camera_axes_projected_vector_px': list(camera_screen),
                    'camera_axes_screen_angle_deg': angle(camera_screen,source2),
                    'pixel_aspect_camera_screen_angle_deg': angle(pixel_screen,source2),
                    'actual_screen_angle_deg': angle(project(tail)-project(start),source2)})
    report['cases'][label] = {'bundle_sha256': digest(path), 'rows': rows}
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
Path(a.out).write_text(json.dumps(report, indent=2)+'\n')
print('CAMERA_BASIS_PROBE_COMPLETE')
