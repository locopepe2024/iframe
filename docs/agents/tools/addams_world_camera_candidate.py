"""Re-express the diagnostic rig and camera in paired inferred world space."""
import json
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = Path('/tmp/addams-pose/gvhmr-native-v1')
paired = json.loads((OUT / 'camera-world-contract.json').read_text())
scale = json.loads((OUT / 'retarget-score.json').read_text())['rig_scale']
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'rotation-candidate.blend'))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
G = C.copy()
names = ('head', 'pelvis', 'ankle_l', 'ankle_r')
expected = []
for row in paired['frames']:
    scene.frame_set(row['model_frame'] + 1)
    bpy.context.view_layer.update()
    expected.append([world_to_camera_view(scene, scene.camera, arm.matrix_world @ arm.pose.bones[n].head).copy() for n in names])
tops = [o for o in scene.objects if o.parent is None]
datum = bpy.data.objects.new('InferredWorldCameraDatum', None)
scene.collection.objects.link(datum)
for obj in tops:
    obj.parent = datum
    obj.matrix_parent_inverse = Matrix.Identity(4)
datum.rotation_mode = 'QUATERNION'
previous = None
for row in paired['frames']:
    rotation = Matrix(row['world_to_cv_rotation'])
    translation = Vector(row['world_to_cv_translation'])
    quaternion = (G @ rotation.transposed() @ C.transposed()).to_quaternion()
    if previous is not None and previous.dot(quaternion) < 0:
        quaternion.negate()
    previous = quaternion.copy()
    datum.rotation_quaternion = quaternion
    datum.location = -scale * (G @ rotation.transposed() @ translation)
    frame = row['model_frame'] + 1
    datum.keyframe_insert('rotation_quaternion', frame=frame)
    datum.keyframe_insert('location', frame=frame)
max_gap_px = 0.0
for row, target in zip(paired['frames'], expected):
    scene.frame_set(row['model_frame'] + 1)
    bpy.context.view_layer.update()
    for n, old in zip(names, target):
        new = world_to_camera_view(scene, scene.camera, arm.matrix_world @ arm.pose.bones[n].head)
        max_gap_px = max(max_gap_px, ((new.x - old.x)**2 * scene.render.resolution_x**2 + (new.y - old.y)**2 * scene.render.resolution_y**2)**0.5)
assert max_gap_px < 0.01, max_gap_px
scene.frame_set(15)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'inferred-world-camera-candidate.blend'))
report = {'schema': 'addams-world-camera-candidate.v1', 'scale': scale,
          'frames': len(paired['frames']), 'checked_joints': names,
          'max_projection_replay_gap_px': max_gap_px,
          'limits': ['Paired model world coordinates are inferred, not ground truth.',
                     'This change preserves existing pose and image errors.',
                     'No IK or physical camera calibration is performed.']}
(OUT / 'world-camera-candidate.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
