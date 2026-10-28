"""Export actual keyed Blender joint projections for review, without refitting."""
import bpy,json,hashlib
from pathlib import Path
from bpy_extras.object_utils import world_to_camera_view
B=Path('/tmp/addams-pose/continuous-ablation-smooth')
blend_file=B/'candidate.blend';bpy.ops.wm.open_mainfile(filepath=str(blend_file));scene=bpy.context.scene;arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
names={s+'_'+part:bone+'_'+suffix for s,suffix in [('left','l'),('right','r')] for part,bone in [('shoulder','upper_arm'),('elbow','lower_arm'),('wrist','wrist'),('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]}
print('BONES',list(arm.pose.bones.keys()),flush=True)
assert all(n in arm.pose.bones for n in names.values())
frames=[]
for sf in range(1,66):
 scene.frame_set(sf);bpy.context.view_layer.update();xy={}
 for name,bone in names.items():
  p=arm.matrix_world@arm.pose.bones[bone].head;q=world_to_camera_view(scene,scene.camera,p);xy[name]=[q.x*960,(1-q.y)*520]
 frames.append({'source_frame':sf,'projected':xy})
d={'schema':'addams-actual-rig-projections.v1','blend_sha256':hashlib.sha256(blend_file.read_bytes()).hexdigest(),'blend_path':str(blend_file),'image_size':[960,520],'camera':scene.camera.name,'fps':scene.render.fps,'frames':frames,'limits':['Actual selected rig/action/camera projections; not ground truth.','Wrist/ankle bone heads, not surface sole/contact points.']}
(B/'review-projections.json').write_text(json.dumps(d,indent=2)+'\n')
