"""Read-only decomposition of baseline output spikes; no new pose solver."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer

p = argparse.ArgumentParser()
for key in ('rig', 'bundle', 'patches', 'track', 'out'):
    p.add_argument('--' + key, required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
bundle = json.loads(Path(a.bundle).read_text())
patches = json.loads(Path(a.patches).read_text())['patch_vertex_ids']
track = {f['source_frame']: f['semantic_joints'] for f in json.loads(Path(a.track).read_text())['frames']}
bpy.ops.wm.open_mainfile(filepath=a.rig)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = bpy.data.objects['white-model-neutral-female-03']
if arm.animation_data:
    arm.animation_data_clear()
root = bpy.data.objects.new('director-motion-root', None)
bpy.context.collection.objects.link(root)
arm.parent = root
renderer.setup_scene(bundle, Path(a.out).parent)
renderer.apply_bundle(bundle, arm)
parts = {'shoulder': 'upper_arm', 'elbow': 'lower_arm', 'wrist': 'wrist',
         'hip': 'upper_leg', 'knee': 'lower_leg', 'ankle': 'ankle'}
previous = None
rows = []
for frame in range(1, 49):
    scene = bpy.context.scene
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    pixels = {}
    for side, suffix in [('left', 'l'), ('right', 'r')]:
        for part, bone in parts.items():
            ndc = world_to_camera_view(scene, scene.camera, arm.matrix_world @ arm.pose.bones[f'{bone}_{suffix}'].head)
            pixels[f'{side}_{part}'] = [ndc.x * 640, (1 - ndc.y) * 360]
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data = ev.to_mesh()
    points = {s: sum((ev.matrix_world @ data.vertices[i].co for i in patches[s]), Vector()) / len(patches[s]) for s in patches}
    ev.to_mesh_clear()
    if previous:
        steps = {k: math.dist(v, previous['pixels'][k]) for k, v in pixels.items()}
        decomposition = {}
        for side, current in points.items():
            old = previous['points'][side]
            hypothetical = root.matrix_world @ previous['root'].inverted() @ old
            root_step = hypothetical - old
            local_step = current - hypothetical
            total = current - old
            assert (root_step + local_step - total).length < 1e-6
            decomposition[side] = {'total_delta': list(total), 'root_only_delta': list(root_step),
                                   'local_pose_delta': list(local_step),
                                   'total_horizontal_speed': math.hypot(total.x, total.y) * bundle['fps'],
                                   'root_horizontal_speed': math.hypot(root_step.x, root_step.y) * bundle['fps'],
                                   'local_horizontal_speed': math.hypot(local_step.x, local_step.y) * bundle['fps']}
        rows.append({'output_frame': frame, 'max_joint_step': max(steps, key=steps.get),
                     'joint_steps_px': steps, 'patch_step_decomposition': decomposition})
    previous = {'pixels': pixels, 'points': points, 'root': root.matrix_world.copy()}
source_rows = []
for first, second in [(25, 27), (27, 29), (31, 33), (33, 35), (35, 37)]:
    source_rows.append({'source_frames': [first, second], 'joints': {
        key: {'image_delta_px': [(track[second][key][0] - track[first][key][0]) * 640,
                                 (track[second][key][1] - track[first][key][1]) * 360],
              'proxy_depth_delta': track[second][key][2] - track[first][key][2]}
        for key in track[first]}})
Path(a.out).write_text(json.dumps({'schema': 'recreation2-motion-spike.v1',
    'units': 'Blender units; source proxy depth is normalized, no metric truth',
    'output_steps': rows, 'source_steps': source_rows}, indent=2) + '\n')
for row in rows:
    if row['output_frame'] in (28, 33):
        print(json.dumps(row))
