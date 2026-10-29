"""Independent contact ablations in a diagnostic camera-space candidate.

No animation keys are written. Source labels select frames, not spatial targets.
The Z plane is a hypothesis; camera-space Z is not proven gravity-up.
"""
import hashlib
import math
import json
import statistics
import sys
from pathlib import Path

import bpy
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

OUT = Path('/tmp/addams-pose/gvhmr-native-v1')
GLOBAL_WORLD = '--global-world' in sys.argv
PATH = OUT / ('inferred-world-camera-candidate.blend' if GLOBAL_WORLD else 'rotation-candidate.blend')
CANONICAL_UP = '--canonical-up' in sys.argv
projection_gaps = []
contract = json.loads((OUT / 'target-rig-contract.json').read_text())
frame_map = json.loads((OUT / 'frame-map.json').read_text())
selected = [min((r for r in frame_map['frames'] if r['source_frame'] == sf),
                key=lambda r: abs(r['timing_error_s'])) for sf in (49, 52, 53)]
indices = contract['feet']['r']['cluster_vertex_indices']
review = json.loads((OUT / 'human-score.json').read_text())
jointmap = {side + '_' + part: bone + '_' + suffix
            for side, suffix in [('left', 'l'), ('right', 'r')]
            for part, bone in [('hip', 'upper_leg'), ('knee', 'lower_leg'), ('ankle', 'ankle'),
                               ('shoulder', 'upper_arm'), ('elbow', 'lower_arm'), ('wrist', 'wrist')]}

def review_score(sf):
    points = next(r['points'] for r in review['frames'] if r['source_frame'] == sf)
    errors = []
    for point in points:
        if point['joint'] not in jointmap:
            continue
        q = world_to_camera_view(scene, scene.camera, head(jointmap[point['joint']]))
        xy = Vector((q.x * scene.render.resolution_x, (1 - q.y) * scene.render.resolution_y))
        errors.append((xy - Vector(point['review_xy'])).length)
    return {'count': len(errors), 'rmse_px': math.sqrt(sum(v*v for v in errors)/len(errors)) if errors else None,
            'max_px': max(errors) if errors else None}

assert all(contract['checks'].values())

def load():
    bpy.ops.wm.open_mainfile(filepath=str(PATH))
    global scene, arm, mesh
    scene = bpy.context.scene
    arm = bpy.data.objects[contract['armature']]
    mesh = bpy.data.objects[contract['mesh']]
    if CANONICAL_UP:
        before = [world_to_camera_view(scene, scene.camera, head(n)).copy()
                  for n in ('head', 'pelvis', 'ankle_r')]
        tops = [o for o in scene.objects if o.parent is None]
        datum = bpy.data.objects.new('DiagnosticCameraUpDatum', None)
        scene.collection.objects.link(datum)
        datum.matrix_world = Matrix.Diagonal((1.0, -1.0, -1.0, 1.0))
        for obj in tops:
            obj.parent = datum
            obj.matrix_parent_inverse = Matrix.Identity(4)
        update()
        after = [world_to_camera_view(scene, scene.camera, head(n)).copy()
                 for n in ('head', 'pelvis', 'ankle_r')]
        projection_gaps.append(max((a - b).length for a, b in zip(before, after)))


def update():
    bpy.context.view_layer.update()

def verts():
    obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    assert max(indices) < len(obj.data.vertices)
    return {i: obj.matrix_world @ obj.data.vertices[i].co for i in indices}

def head(n):
    return arm.matrix_world @ arm.pose.bones[n].head

def ankle():
    return arm.matrix_world @ arm.pose.bones['lower_leg_r'].tail

load()
baselines = []
for r in selected:
    scene.frame_set(r['model_frame'] + 1)
    update()
    v = verts()
    if not baselines:
        contact_index = min(v, key=lambda i: v[i].z)
    baselines.append({'source_frame': r['source_frame'],
                      'blender_frame': r['model_frame'] + 1,
                      'timing_error_s': r['timing_error_s'],
                      'arm_origin': list(arm.matrix_world.translation),
                      'root': list(head('root')), 'pelvis': list(head('pelvis')),
                      'ankle': list(ankle()), 'contact': list(v[contact_index]),
                      'min_z': min(p.z for p in v.values()),
                      'max_z': max(p.z for p in v.values()),
                      'body_up': list((head('head') - head('pelvis')).normalized()),
                      'camera_up': list(scene.camera.matrix_world.to_3x3() @ Vector((0, 1, 0)))})
ground = statistics.median(b['min_z'] for b in baselines)
anchor = Vector(baselines[0]['contact'])
rows = []
for condition in ('none', 'solver-only', 'height', 'xy', 'full'):
    for baseline in baselines:
        # Reload per condition AND frame: no carryover from solver state or keyframes.
        load()
        scene.frame_set(baseline['blender_frame'])
        update()
        original = verts()
        before_score = review_score(baseline['source_frame'])
        a0 = ankle().copy()
        l0 = head('ankle_l').copy()
        p0 = head('pelvis').copy()
        q0 = (arm.matrix_world @ arm.pose.bones['ankle_r'].matrix).to_quaternion()
        target = bpy.data.objects.new('ContactAblationAnkle', None)
        scene.collection.objects.link(target)
        target.location = a0
        orientation = bpy.data.objects.new('ContactAblationOrientation', None)
        scene.collection.objects.link(orientation)
        orientation.matrix_world = arm.matrix_world @ arm.pose.bones['ankle_r'].matrix
        ik = arm.pose.bones['lower_leg_r'].constraints.new('IK')
        ik.target = target
        ik.chain_count = 2
        ik.iterations = 100
        copy = arm.pose.bones['ankle_r'].constraints.new('COPY_ROTATION')
        copy.target = orientation
        copy.target_space = copy.owner_space = 'WORLD'
        ik.mute = copy.mute = condition == 'none'
        update()
        activation_displacement = (ankle() - a0).length
        iteration = 0
        if condition in ('height', 'xy', 'full'):
            for iteration in range(40):
                current = verts()
                delta = Vector((0, 0, 0))
                if condition in ('xy', 'full'):
                    delta.x = anchor.x - current[contact_index].x
                    delta.y = anchor.y - current[contact_index].y
                if condition in ('height', 'full'):
                    delta.z = ground - min(p.z for p in current.values())
                if delta.length < 0.00005:
                    break
                target.location += delta
                update()
        after = verts()
        a1 = ankle().copy()
        q1 = (arm.matrix_world @ arm.pose.bones['ankle_r'].matrix).to_quaternion()
        rows.append({'condition': condition, 'source_frame': baseline['source_frame'],
                     'review_before': before_score, 'review_after': review_score(baseline['source_frame']),
                     'blender_frame': baseline['blender_frame'],
                     'activation_ankle_displacement_m': activation_displacement,
                     'ankle_displacement_m': (a1 - a0).length,
                     'ankle_delta_world': list(a1 - a0),
                     'after_z_gap_m': min(p.z for p in after.values()) - ground,
                     'after_anchor_xy_error_m': (after[contact_index] - anchor).xy.length,
                     'before_anchor_xy_error_m': (original[contact_index] - anchor).xy.length,
                     'left_ankle_displacement_m': (head('ankle_l') - l0).length,
                     'pelvis_displacement_m': (head('pelvis') - p0).length,
                     'ankle_world_rotation_delta_rad': q0.rotation_difference(q1).angle,
                     'max_mesh_displacement_m': max((after[i] - original[i]).length for i in indices),
                     'iterations': iteration + 1,
                     'within_5cm_ankle_budget': (a1 - a0).length <= 0.05})

movement = []
first = baselines[0]
for b in baselines:
    dp = Vector(b['pelvis']) - Vector(first['pelvis'])
    da = Vector(b['ankle']) - Vector(first['ankle'])
    rel = (Vector(b['ankle']) - Vector(b['pelvis'])) - (Vector(first['ankle']) - Vector(first['pelvis']))
    assert (da - dp - rel).length < 1e-5
    movement.append({'source_frame': b['source_frame'], 'pelvis_delta': list(dp),
                     'ankle_delta': list(da), 'ankle_relative_pelvis_delta': list(rel),
                     'contact_delta': list(Vector(b['contact']) - Vector(first['contact']))})

report = {'schema': 'addams-target-contact-ablation.v1',
          'inferred_global_world': GLOBAL_WORLD, 'canonical_camera_up': CANONICAL_UP,
          'projection_invariance_max_ndc': max(projection_gaps, default=0.0),
          'candidate_sha256': hashlib.sha256(PATH.read_bytes()).hexdigest(),
          'contact_vertex': contact_index, 'diagnostic_plane_z': ground,
          'baseline': baselines, 'movement_decomposition': movement, 'rows': rows,
          'checks': {'no_constraint_baseline': all(r['max_mesh_displacement_m'] < 1e-5 for r in rows if r['condition'] == 'none'),
                     'non_support_unchanged': all(r['left_ankle_displacement_m'] < 1e-5 for r in rows),
                     'pelvis_unchanged': all(r['pelvis_displacement_m'] < 1e-5 for r in rows)},
          'limits': ['Camera-up convention is not verified gravity or scene ground; camera pitch is unknown.',
                     'Fixed mesh contact point is a hypothesis; rolling/pivot is not classified.',
                     'Three labelled frames do not validate continuous contact or full motion.',
                     'Fresh scene per cell; no new animation keys or production edits.']}
assert all(report['checks'].values()), report['checks']
(OUT / ('target-contact-ablation-global-world.json' if GLOBAL_WORLD else 'target-contact-ablation-canonical-up.json' if CANONICAL_UP else 'target-contact-ablation.json')).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
