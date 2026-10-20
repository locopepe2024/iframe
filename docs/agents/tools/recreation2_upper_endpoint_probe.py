"""Read-only evaluated upper-body geometry from frozen yaw-in-solve bundles."""
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

def project(v):
    s = bpy.context.scene
    q = world_to_camera_view(s, s.camera, v)
    return Vector((q.x * 640, (1 - q.y) * 360))

def angle(u, v):
    return math.degrees(math.acos(max(-1, min(1, u.normalized().dot(v.normalized())))))

report = {'schema': 'recreation2-upper-endpoints.v1', 'blender': bpy.app.version_string,
          'sha256': {k: hashlib.sha256(Path(v).read_bytes()).hexdigest() for k, v in [('rig', a.rig), ('track', a.track), ('anchors', a.anchors), ('probe', __file__)]}, 'cases': {}}
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
    torso_rows = []
    for source in (1, 17, 23, 29, 41, 55):
        bpy.context.scene.frame_set(anchors[source])
        bpy.context.view_layer.update()
        original = track[source]
        joints = {k: [v[0], v[1]*factor, v[2]] for k,v in original.items()}
        def head(name):
            return arm.matrix_world @ arm.pose.bones[name].head
        hip = (head('upper_leg_l') + head('upper_leg_r')) * .5
        shoulder = (head('upper_arm_l') + head('upper_arm_r')) * .5
        src_hip = Vector(((original['left_hip'][0]+original['right_hip'][0])*320, (original['left_hip'][1]+original['right_hip'][1])*180))
        src_shoulder = Vector(((original['left_shoulder'][0]+original['right_shoulder'][0])*320, (original['left_shoulder'][1]+original['right_shoulder'][1])*180))
        torso_rows.append({'source_frame': source,
            'body_hip_to_shoulder_target_angle_deg': angle(shoulder-hip,solver['torso'](joints)),
            'hip_center_residual_px':list(project(hip)-src_hip),
            'shoulder_center_residual_px':list(project(shoulder)-src_shoulder),
            'spine_bones':[{'bone':n,'head_world':list(head(n)), 'tail_world':list(arm.matrix_world @ arm.pose.bones[n].tail)} for n in ('spine_lower','spine_mid','spine_chest')]})
        for side, suffix in [('left', 'l'), ('right', 'r')]:
            bones = [arm.pose.bones[f'{name}_{suffix}'] for name in ('upper_arm', 'lower_arm', 'wrist')]
            heads = [arm.matrix_world @ b.head for b in bones]
            pix = [project(v) for v in heads]
            src = [Vector((original[f'{side}_{name}'][0]*640, original[f'{side}_{name}'][1]*360)) for name in ('shoulder','elbow','wrist')]
            residual = [pix[i]-src[i] for i in range(3)]
            segments = []
            for i, names in enumerate([('shoulder','elbow'), ('elbow','wrist')]):
                bone = bones[i]
                tail = arm.matrix_world @ bone.tail
                target = solver['vec'](joints, *(f'{side}_{n}' for n in names))
                actual = tail-heads[i]
                ideal_end = heads[i]+target*actual.length
                rig_vector, source_vector = pix[i+1]-pix[i], src[i+1]-src[i]
                segments.append({'bone': bone.name, 'world_direction_error_deg': angle(actual,target),
                    'world_bone_length': actual.length, 'tail_to_next_head_units': (tail-heads[i+1]).length,
                    'screen_direction_error_deg': angle(rig_vector,source_vector),
                    'rig_projected_length_px': rig_vector.length, 'source_projected_length_px': source_vector.length,
                    'segment_vector_residual_px': list(rig_vector-source_vector),
                    'actual_tail_to_target_direction_endpoint_px': (project(tail)-project(ideal_end)).length,
                    'target_direction_endpoint_to_source_px': (project(ideal_end)-src[i+1]).length})
            reconstructed = residual[0]+Vector(segments[0]['segment_vector_residual_px'])+Vector(segments[1]['segment_vector_residual_px'])
            assert (reconstructed-residual[2]).length < .001
            rows.append({'source_frame':source,'side':side,'joint_residual_vectors_px':{n:list(r) for n,r in zip(('shoulder','elbow','wrist'),residual)},
                         'joint_errors_px':{n:r.length for n,r in zip(('shoulder','elbow','wrist'),residual)},'segments':segments,
                         'clavicle': {'world_direction_error_deg':angle(solver['wd'](arm,arm.pose.bones[f'clavicle_{suffix}']),solver['clavicle'](joints,suffix)),
                             'tail_to_shoulder_head_units':((arm.matrix_world @ arm.pose.bones[f'clavicle_{suffix}'].tail)-heads[0]).length}})
    report['cases'][label] = {'bundle_sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rows':rows, 'torso_rows':torso_rows}
Path(a.out).parent.mkdir(parents=True,exist_ok=True)
Path(a.out).write_text(json.dumps(report,indent=2)+'\n')
print('UPPER_ENDPOINT_PROBE_COMPLETE')
