"""Apply fitted local rotations in Blender, verify keyed replay, export actual projections."""
import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Vector,Quaternion
from bpy_extras.object_utils import world_to_camera_view
B=Path('/tmp/addams-pose');O=B/'fullbody-reviewed-v1';fit=json.loads((O/'fit.json').read_text());bpy.ops.wm.open_mainfile(filepath=str(B/'continuous-ablation-smooth/candidate.blend'))
a=next(o for o in bpy.data.objects if o.type=='ARMATURE');scene=bpy.context.scene;a.animation_data.action=a.animation_data.action.copy();a.animation_data.action.name='FullbodyReviewed49To58'
for f in fit['frames']:
 sf=f['source_frame'];scene.frame_set(sf);bpy.context.view_layer.update();dx,dy=f['root_delta_px'];a.location+=Vector((dx/fit['scale'],0,-dy/fit['scale']));a.keyframe_insert(data_path='location',frame=sf)
 for n,r in zip(fit['active_bones'],f['rotation_deltas']):
  b=a.pose.bones[n];v=Vector(r);q=Quaternion(v.normalized(),v.length) if v.length>1e-12 else Quaternion();b.rotation_quaternion=b.rotation_quaternion@q;b.keyframe_insert(data_path='rotation_quaternion',frame=sf)
joint_bones={s+'_'+p:b+'_'+suffix for s,suffix in [('left','l'),('right','r')] for p,b in [('shoulder','upper_arm'),('elbow','lower_arm'),('wrist','wrist'),('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]}
gaps=[];projections=[];expected={f['source_frame']:f for f in fit['frames']}
for sf in range(1,66):
 scene.frame_set(sf);bpy.context.view_layer.update();xy={}
 for n,b in joint_bones.items():
  p=a.matrix_world@a.pose.bones[b].head;q=world_to_camera_view(scene,scene.camera,p);xy[n]=[960*q.x,520*(1-q.y)]
  if sf in expected:gaps.append((p-Vector(expected[sf]['xyz'][n])).length)
 projections.append({'source_frame':sf,'projected':xy})
assert max(gaps)<1e-4,max(gaps)
scene.frame_set(49);bpy.ops.wm.save_as_mainfile(filepath=str(O/'candidate.blend'))
result={'schema':'addams-actual-rig-projections.v1','blend_sha256':hashlib.sha256((O/'candidate.blend').read_bytes()).hexdigest(),'blend_path':str(O/'candidate.blend'),'image_size':[960,520],'camera':scene.camera.name,'fps':scene.render.fps,'frames':projections,'annotation_sha256':fit['input_sha256'],'fit_metrics':{'baseline':fit['baseline'],'fitted':fit['fitted']},'limits':fit['limits']}
(O/'review-projections.json').write_text(json.dumps(result,indent=2)+'\n');(O/'replay.json').write_text(json.dumps({'max_endpoint_error_units':max(gaps),'checked_frames':list(expected),'projection_frames':65},indent=2)+'\n')
for sf in [48,49,50,51,54,58,59]:
 scene.frame_set(sf);scene.render.filepath=str(O/f'front-{sf:03}.png');bpy.ops.render.render(write_still=True)
print('FULLBODY_REPLAY',max(gaps),flush=True)
