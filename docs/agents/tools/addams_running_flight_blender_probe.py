"""Media-only, isolated flight/contact ablation. Never edits the input blend."""
import hashlib
import json
import statistics
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from addams_contact_phase_gate import frame_gate

BASE = Path('/tmp/addams-pose/gvhmr-native-v1')
OUT = BASE / 'running-flight-v1'
OUT.mkdir(exist_ok=False)
PATH = BASE / 'inferred-world-camera-candidate.blend'
contract = json.loads((BASE / 'target-rig-contract.json').read_text())
frame_map = json.loads((BASE / 'frame-map.json').read_text())
assert all(contract['checks'].values())
labels = {58: 'left', 62: 'left', 64: 'airborne'}
selected = [min((r for r in frame_map['frames'] if r['source_frame'] == sf),
                key=lambda r: abs(r['timing_error_s'])) for sf in range(58, 66)]


def load(frame):
    bpy.ops.wm.open_mainfile(filepath=str(PATH))
    global scene, arm, mesh
    scene = bpy.context.scene
    arm = bpy.data.objects[contract['armature']]
    mesh = bpy.data.objects[contract['mesh']]
    scene.frame_set(frame)
    update()


def update():
    bpy.context.view_layer.update()


def head(name):
    return arm.matrix_world @ arm.pose.bones[name].head


def vertices():
    obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return {s: {i: obj.matrix_world @ obj.data.vertices[i].co
                for i in contract['feet'][s]['cluster_vertex_indices']} for s in ['l', 'r']}


def ankle(side):
    return arm.matrix_world @ arm.pose.bones['lower_leg_' + side].tail


source_hash = hashlib.sha256(PATH.read_bytes()).hexdigest()
heights = []
for r in selected:
    if r['source_frame'] in [58, 62]:
        load(r['model_frame'] + 1)
        heights.append(min(p.z for p in vertices()['l'].values()))
ground = statistics.median(heights)
rows = []
for condition in ['none', 'stale-left', 'explicit-phase']:
    for r in selected:
        sf = r['source_frame']
        load(r['model_frame'] + 1)
        original = vertices()
        original_ankles = {s: ankle(s).copy() for s in ['l', 'r']}
        original_pelvis = head('pelvis').copy()
        gate = frame_gate(sf, labels)
        weights = {'left': 0.0, 'right': 0.0} if condition == 'none' else (
            {'left': 1.0, 'right': 0.0} if condition == 'stale-left' else gate)
        iterations = {}
        for side, name in [('l', 'left'), ('r', 'right')]:
            target = bpy.data.objects.new('FlightDiagnosticAnkle_' + side, None)
            scene.collection.objects.link(target)
            target.location = original_ankles[side]
            orient = bpy.data.objects.new('FlightDiagnosticOrientation_' + side, None)
            scene.collection.objects.link(orient)
            orient.matrix_world = arm.matrix_world @ arm.pose.bones['ankle_' + side].matrix
            ik = arm.pose.bones['lower_leg_' + side].constraints.new('IK')
            ik.name = 'DiagnosticContactGate_' + side
            ik.target = target
            ik.chain_count = 2
            ik.iterations = 100
            ik.influence = weights[name]
            copy = arm.pose.bones['ankle_' + side].constraints.new('COPY_ROTATION')
            copy.target = orient
            copy.target_space = copy.owner_space = 'WORLD'
            copy.influence = weights[name]
            update()
            iteration = 0
            if weights[name]:
                for iteration in range(30):
                    lowest = min(p.z for p in vertices()[side].values())
                    delta = ground - lowest
                    if abs(delta) < 0.00005:
                        break
                    target.location.z += max(-0.02, min(0.02, delta))
                    update()
            iterations[side] = iteration
        after = vertices()
        row = {'condition': condition, 'source_frame': sf, 'blender_frame': r['model_frame'] + 1,
               'timing_error_s': r['timing_error_s'], 'label': gate['state'],
               'weights': {n: weights[n] for n in ['left', 'right']},
               'min_sole_height_m': {s: min(p.z for p in after[s].values()) - ground for s in ['l', 'r']},
               'before_min_sole_height_m': {s: min(p.z for p in original[s].values()) - ground for s in ['l', 'r']},
               'ankle_displacement_m': {s: (ankle(s) - original_ankles[s]).length for s in ['l', 'r']},
               'max_foot_mesh_displacement_m': max((after[s][i] - original[s][i]).length for s in ['l', 'r'] for i in original[s]),
               'pelvis_displacement_m': (head('pelvis') - original_pelvis).length,
               'iterations': iterations}
        rows.append(row)
        if sf == 64:
            scene.render.engine = 'BLENDER_WORKBENCH'
            scene.render.resolution_x = 960
            scene.render.resolution_y = 520
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(OUT / (condition + '-064.png'))
            bpy.ops.render.render(write_still=True)
            bpy.ops.wm.save_as_mainfile(filepath=str(OUT / (condition + '-064-diagnostic.blend')))

flight = next(r for r in rows if r['condition'] == 'explicit-phase' and r['source_frame'] == 64)
checks = {'flight_weights_zero': all(v == 0 for v in flight['weights'].values()),
          'flight_pose_preserved': flight['max_foot_mesh_displacement_m'] < 1e-5,
          'pelvis_unchanged': all(r['pelvis_displacement_m'] < 1e-5 for r in rows),
          'input_blend_unchanged': hashlib.sha256(PATH.read_bytes()).hexdigest() == source_hash}
report = {'schema': 'addams-running-flight-ablation.v1', 'candidate_sha256': source_hash,
          'source_sha256': frame_map['source_sha256'], 'diagnostic_ground_z': ground,
          'ground_from_source_frames': [58, 62], 'source_fps': frame_map['source_fps'],
          'model_fps': frame_map['model_fps'], 'labels': labels, 'rows': rows, 'checks': checks,
          'production_eligible': False,
          'limits': ['Ground plane is a within-candidate diagnostic convention, not recovered source ground.',
                     'Sparse contact labels do not determine flight interval endpoints.',
                     'Stale lock is a counterfactual, not evidence it ran historically.',
                     'Zero IK preserves existing pose; it does not reconstruct a missing flight trajectory.',
                     'Blend files are single-frame diagnostic snapshots, not a validated continuous edit.']}
(OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
assert all(checks.values()), checks
print(json.dumps({'checks': checks, 'flight': flight, 'diagnostic_ground_z': ground}), flush=True)
