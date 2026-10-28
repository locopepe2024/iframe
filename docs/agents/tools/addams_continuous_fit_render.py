import bpy,json,math
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
B=Path('/tmp/addams-pose');O=B/'continuous-shot1-v2';fit=json.loads((O/'fit.json').read_text());bpy.ops.wm.open_mainfile(filepath=str(B/'continuous-shot1-v1/candidate.blend'))
a=next(o for o in bpy.data.objects if o.type=='ARMATURE');a.animation_data.action=a.animation_data.action.copy();a.animation_data.action.name='HumanConstrainedShot1';scene=bpy.context.scene;scale=fit['scale_review_px_per_unit'];previous={};gaps=[]
for f in fit['frames']:
 sf=f['source_frame'];scene.frame_set(sf);bpy.context.view_layer.update();dx,dy=f['root_delta_review_px'];a.location+=Vector((dx/scale,0,-dy/scale));a.keyframe_insert(data_path='location',frame=sf)
 for name,d in zip(['upper_leg_l','lower_leg_l','upper_leg_r','lower_leg_r'],f['leg_directions_blender']):
  b=a.pose.bones[name];bpy.context.view_layer.update();current=(a.matrix_world@b.tail-a.matrix_world@b.head).normalized();basis=(a.matrix_world@b.matrix).to_quaternion();b.rotation_quaternion=b.rotation_quaternion@(basis.inverted()@current.rotation_difference(Vector(d))@basis);bpy.context.view_layer.update()
  if name in previous and b.rotation_quaternion.dot(previous[name])<0:b.rotation_quaternion.negate()
  previous[name]=b.rotation_quaternion.copy();b.keyframe_insert(data_path='rotation_quaternion',frame=sf)
 for s,suffix in [('left','l'),('right','r')]:
  for part,bone in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:gaps.append(((a.matrix_world@a.pose.bones[bone+'_'+suffix].head)-Vector(f['xyz'][s+'_'+part])).length)
assert max(gaps)<1e-4,max(gaps)
replay=[];pixel=[]
for f in fit['frames']:
 scene.frame_set(f['source_frame']);bpy.context.view_layer.update()
 for s,suffix in [('left','l'),('right','r')]:
  for part,bone in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:
   actual=a.matrix_world@a.pose.bones[bone+'_'+suffix].head;expected=Vector(f['xyz'][s+'_'+part]);replay.append((actual-expected).length);q=world_to_camera_view(scene,scene.camera,actual);pixel.append(math.dist([960*q.x,520*(1-q.y)],[480+scale*expected.x,260-scale*expected.z]))
assert max(replay)<1e-4,max(replay);assert max(pixel)<.01,max(pixel)
(O/'replay.json').write_text(json.dumps({'max_endpoint_error_units':max(replay),'max_projection_error_review_px':max(pixel),'frame_count':65,'limits':['Numerical roundtrip only; not source motion acceptance.']},indent=2)+'\n')
scene.frame_set(23);bpy.ops.wm.save_as_mainfile(filepath=str(O/'candidate.blend'))
for sf in range(1,66):scene.frame_set(sf);scene.render.filepath=str(O/f'front-{sf:03}.png');bpy.ops.render.render(write_still=True)
print('FIT_REPLAY_OK',max(replay),max(pixel),flush=True)
