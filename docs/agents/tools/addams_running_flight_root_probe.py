"""Single-frame whole-body clearance sensitivity, no recovered-height claim."""
import json
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path('/tmp/addams-pose/gvhmr-native-v1')
OUT = BASE / 'running-flight-v1'
PATH = BASE / 'inferred-world-camera-candidate.blend'
contract = json.loads((BASE / 'target-rig-contract.json').read_text())
frame_map = json.loads((BASE / 'frame-map.json').read_text())
ground = json.loads((OUT / 'report.json').read_text())['diagnostic_ground_z']
row = min((r for r in frame_map['frames'] if r['source_frame'] == 64), key=lambda r: abs(r['timing_error_s']))
nearest = row['model_frame'] + 1
exact = 1 + (64 - frame_map['source_range'][0]) / frame_map['source_fps'] * frame_map['model_fps']
rows = []
for timing, bf in [('nearest', nearest), ('exact-source-pts', exact)]:
    for clearance in [None, 0.0, 0.01, 0.02]:
        bpy.ops.wm.open_mainfile(filepath=str(PATH))
        scene = bpy.context.scene
        arm = bpy.data.objects[contract['armature']]
        mesh = bpy.data.objects[contract['mesh']]
        scene.frame_set(int(bf), subframe=bf - int(bf))
        bpy.context.view_layer.update()
        def soles():
            obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            return {s: min((obj.matrix_world @ obj.data.vertices[i].co).z for i in contract['feet'][s]['cluster_vertex_indices']) - ground for s in ['l', 'r']}
        def heads():
            return {b.name: arm.matrix_world @ b.head for b in arm.pose.bones}
        def projection(points):
            return {n: Vector((q.x * scene.render.resolution_x, (1 - q.y) * scene.render.resolution_y))
                    for n, v in points.items() for q in [world_to_camera_view(scene, scene.camera, v)]}
        before = soles()
        points = heads()
        pixels = projection(points)
        delta_z = 0.0 if clearance is None else max(0.0, clearance - min(before.values()))
        mat = arm.matrix_world.copy()
        mat.translation.z += delta_z
        arm.matrix_world = mat
        bpy.context.view_layer.update()
        after = soles()
        after_heads = heads()
        after_pixels = projection(after_heads)
        rigid_error = max(((after_heads[n] - after_heads['pelvis']) - (v - points['pelvis'])).length for n, v in points.items())
        rows.append({'timing': timing, 'blender_frame': bf, 'clearance_target_m': clearance,
                     'root_lift_m': delta_z, 'before_sole_height_m': before, 'after_sole_height_m': after,
                     'max_relative_joint_change_m': rigid_error,
                     'max_joint_projection_shift_px': max((after_pixels[n] - pixels[n]).length for n in points),
                     'floor_satisfied': None if clearance is None else min(after.values()) >= clearance - 1e-5})
        assert rigid_error < 1e-5
        if timing == 'exact-source-pts' and clearance in [None, 0.01]:
            tag = 'exact-baseline' if clearance is None else 'root-clearance-1cm'
            scene.render.engine = 'BLENDER_WORKBENCH'
            scene.render.resolution_x = 960
            scene.render.resolution_y = 520
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(OUT / (tag + '-064.png'))
            bpy.ops.render.render(write_still=True)
            bpy.ops.wm.save_as_mainfile(filepath=str(OUT / (tag + '-064-diagnostic.blend')))
report = {'schema': 'addams-running-flight-root-sensitivity.v1', 'source_frame': 64,
          'source_pts_s': (64 - 1) / 25, 'ground_z': ground, 'rows': rows,
          'production_eligible': False,
          'limits': ['Clearances are chosen diagnostic values, not measured source heights.',
                     'Single-frame lift is not a continuous flight curve and must not be spliced directly.',
                     'Floor, camera and original pose uncertainties remain; no image-alignment gain claimed.']}
(OUT / 'root-sensitivity.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
