"""Blender diagnostic: fixed rig, four leg rotations, diagnostic orthographic projection."""
import json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
BASE=Path('/tmp/addams-pose')
RIG=Path('/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend')
world_path=BASE/'world-candidate.json';image_path=BASE/'observations.json'
world=json.loads(world_path.read_text());images={f['source_frame']:f for f in json.loads(image_path.read_text())}
bpy.ops.wm.open_mainfile(filepath=str(RIG))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
if arm.animation_data:arm.animation_data_clear()
for b in arm.pose.bones:
 b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
NAMES=['upper_leg_l','lower_leg_l','upper_leg_r','lower_leg_r']
rest={n:(arm.matrix_world@arm.pose.bones[n].tail-arm.matrix_world@arm.pose.bones[n].head).length for n in NAMES}
cam=bpy.data.objects.new('diagnostic-ortho',bpy.data.cameras.new('diagnostic-ortho-data'));bpy.context.collection.objects.link(cam)
cam.location=(0,-6,1);cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.5
scene=bpy.context.scene;scene.camera=cam;scene.render.resolution_x=960;scene.render.resolution_y=520;scene.render.resolution_percentage=100;scene.render.fps=25
rows=[];bundle=[]
for src in world['frames']:
 sf=src['source_frame']
 if not 6<=sf<=24:continue
 scene.frame_set(sf)
 for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0)
 bpy.context.view_layer.update()
 pts=src['pose_world_landmarks'][0];directions=[];qs={}
 for name,a,b in [('upper_leg_l',23,25),('lower_leg_l',25,27),('upper_leg_r',24,26),('lower_leg_r',26,28)]:
  p=arm.pose.bones[name];v=Vector(tuple(pts[b][k]-pts[a][k] for k in 'xyz'));target=Vector((v.x,v.z,-v.y)).normalized()
  current=(arm.matrix_world@p.tail-arm.matrix_world@p.head).normalized();delta=current.rotation_difference(target)
  basis=(arm.matrix_world@p.matrix).to_quaternion();p.rotation_quaternion=basis.inverted()@delta@basis
  bpy.context.view_layer.update();actual=(arm.matrix_world@p.tail-arm.matrix_world@p.head)
  angle=math.degrees(actual.normalized().angle(target));gap=abs(actual.length-rest[name]);assert angle<.1,(sf,name,angle);assert gap<1e-5
  q=p.rotation_quaternion;qs[name]=[q.x,q.y,q.z,q.w];p.keyframe_insert(data_path='rotation_quaternion',frame=sf)
  directions.append({'bone':name,'target_xyz':list(target),'actual_xyz':list(actual.normalized()),'direction_error_deg':angle,'rest_length':rest[name],'length_delta':gap})
 pixels={};joints=[]
 for side,suffix,ids in [('left','l',[23,25,27]),('right','r',[24,26,28])]:
  for part,bone,j in zip(['hip','knee','ankle'],['upper_leg','lower_leg','ankle'],ids):
   p=arm.matrix_world@arm.pose.bones[bone+'_'+suffix].head;q=world_to_camera_view(scene,cam,p);key=side+'_'+part
   pixels[key]=[q.x*960,(1-q.y)*520];obs=images[sf]['mediapipe'][j];joints.append({'name':key,'projected':pixels[key],'source':[obs['x']/4,obs['y']/4]})
 closure={s:(arm.matrix_world@arm.pose.bones['upper_leg_'+s].tail-arm.matrix_world@arm.pose.bones['lower_leg_'+s].head).length for s in ['l','r']}
 rows.append({'source_frame':sf,'pts_s':src['pts_s'],'directions':directions,'thigh_tail_to_knee_head_gap':closure,'joints':joints})
 bundle.append({'frame':sf,'source_pts_s':src['pts_s'],'rootPosition':None,'rootYaw':0,'pelvisQuaternion':None,'localQuaternions':qs})
scene.frame_start=6;scene.frame_end=24
(BASE/'fixed-rig.bundle.json').write_text(json.dumps({'schema':'director-full-motion-bundle.v1','fps':25,'frame_range':[6,24],'frames':bundle,'review_status':'diagnostic_only','limits':['four leg channels only','root and pelvis frozen, camera arbitrary']},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'fixed-rig-diagnostic.blend'))
report={'schema':'addams-fixed-rig-probe.v1','rig_sha256':hashlib.sha256(RIG.read_bytes()).hexdigest(),'world_input_sha256':hashlib.sha256(world_path.read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'camera':'arbitrary orthographic, not source camera','axis_mapping':'MP x,y,z -> Blender x,z,-y (diagnostic hypothesis)','rest_lengths':rest,'frames':rows,'limits':['Not original706-bone L3 rig; pinned neutral female diagnostic rig','No global root, pelvis fit, IK, contact, or source intrinsics','Mapping accuracy does not establish source3D accuracy']}
(BASE/'fixed-rig-report.json').write_text(json.dumps(report,indent=2));print('FIXED_RIG_COMPLETE')
