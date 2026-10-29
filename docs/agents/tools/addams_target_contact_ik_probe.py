"""Isolated target-mesh contact experiment. No source shoe pixels are consumed."""
import json
import sys
import statistics
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path('/tmp/addams-pose/gvhmr-native-v1')
contract = json.loads((OUT / 'target-rig-contract.json').read_text())
assert all(contract['checks'].values())
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'rotation-candidate.blend'))
scene = bpy.context.scene
arm = bpy.data.objects[contract['armature']]
mesh = bpy.data.objects[contract['mesh']]
indices = contract['feet']['r']['cluster_vertex_indices']
ground = contract['ground_plane_candidate']['offset_z']
mode = 'support-median' if '--support-median' in sys.argv else 'asset-rest'

def vertices():
    obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return {i: obj.matrix_world @ obj.data.vertices[i].co for i in indices}

if mode == 'support-median':
    support_heights = []
    for sf in (49, 52, 53):
        frame = min(range(35), key=lambda i: abs(37 + round(i * 25 / 30) - sf)) + 1
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        support_heights.append(min(v.z for v in vertices().values()))
    ground = statistics.median(support_heights)

target = bpy.data.objects.new('TargetContactAnkle', None)
scene.collection.objects.link(target)
orientation = bpy.data.objects.new('TargetContactOrientation', None)
scene.collection.objects.link(orientation)
ik = arm.pose.bones['lower_leg_r'].constraints.new('IK')
ik.name = 'DiagnosticTargetGroundIK'
ik.target = target
ik.chain_count = 2
ik.iterations = 100
copy = arm.pose.bones['ankle_r'].constraints.new('COPY_ROTATION')
copy.target = orientation
copy.target_space = 'WORLD'
copy.owner_space = 'WORLD'
ik.mute = copy.mute = True
rows = []
anchor = None
for sf in (49, 52, 53):
    frame = min(range(35), key=lambda i: abs(37 + round(i * 25 / 30) - sf)) + 1
    ik.mute = copy.mute = True
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    before = vertices()
    if anchor is None:
        contact_index = min(before, key=lambda i: before[i].z)
        anchor = before[contact_index].copy()
        anchor.z = ground
    ankle = arm.matrix_world @ arm.pose.bones['lower_leg_r'].tail
    orientation.matrix_world = arm.matrix_world @ arm.pose.bones['ankle_r'].matrix
    left_before = arm.matrix_world @ arm.pose.bones['lower_leg_l'].tail
    target.location = ankle
    ik.mute = copy.mute = False
    for iteration in range(40):
        bpy.context.view_layer.update()
        current = vertices()
        delta = anchor - current[contact_index]
        # Retain the original foot pitch; only correct leg-chain position.
        delta.z = ground - min(v.z for v in current.values())
        if delta.length < 0.00005:
            break
        target.location += delta
    bpy.context.view_layer.update()
    after = vertices()
    left_after = arm.matrix_world @ arm.pose.bones['lower_leg_l'].tail
    rows.append({
        'source_frame': sf, 'blender_frame': frame,
        'before_min_sole_height_m': min(v.z for v in before.values()) - ground,
        'after_min_sole_height_m': min(v.z for v in after.values()) - ground,
        'after_anchor_xy_error_m': (after[contact_index] - anchor).xy.length,
        'ankle_displacement_m': ((arm.matrix_world @ arm.pose.bones['lower_leg_r'].tail) - ankle).length,
        'non_support_ankle_displacement_m': (left_after - left_before).length,
        'iterations': iteration + 1,
    })
    target.keyframe_insert(data_path='location', frame=frame)
    orientation.rotation_mode = 'QUATERNION'
    orientation.keyframe_insert(data_path='rotation_quaternion', frame=frame)

report = {'schema': 'addams-target-contact-ik-probe.v1', 'rows': rows,
          'contact_vertex': contact_index, 'ground_z': ground, 'ground_mode': mode,
          'local_correction_limit_m': 0.05,
          'local_ik_pass': all(abs(r['after_min_sole_height_m']) <= 0.001 and r['after_anchor_xy_error_m'] <= 0.001 and r['ankle_displacement_m'] <= 0.05 for r in rows),
          'limits': ['Three labelled support frames only; no continuous foot-slip claim.',
                     'Ground is a diagnostic target-space hypothesis, not recovered source ground.',
                     'Mesh partition and single contact vertex remain heuristic.',
                     'Knee pole and tiptoe semantics require separate validation.']}
(OUT / ('target-contact-ik-' + mode + '.json')).write_text(json.dumps(report, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / ('target-contact-ik-' + mode + '-candidate.blend')))
print(json.dumps(report, indent=2), flush=True)
