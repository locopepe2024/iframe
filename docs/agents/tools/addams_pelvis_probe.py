"""Right-handed pelvis ablation; diagnostic pinned rig only."""
import json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
P=Path('/tmp/addams-pose');RIG=Path('/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend')
world=json.loads((P/'world-candidate.json').read_text())
def mapped(p):return Vector((p['x'],p['z'],-p['y']))
def update():bpy.context.view_layer.update()
def head(n):return arm.matrix_world@arm.pose.bones[n].head

def frame(x,up):
 x=x.normalized();y=up.cross(x).normalized();z=x.cross(y).normalized()
 assert y.length>.99
 m=Matrix((x,y,z)).transposed();assert abs(m.determinant()-1)<1e-5
 return m

bpy.ops.wm.open_mainfile(filepath=str(RIG));arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
if arm.animation_data:arm.animation_data_clear()
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
update();restx=head('upper_leg_r')-head('upper_leg_l');restup=(head('upper_arm_l')+head('upper_arm_r')-head('upper_leg_l')-head('upper_leg_r'))/2
rest=frame(restx,restup);rows=[]
for case in ['frozen','hip_axis','hip_torso_frame']:
 for f in world['frames']:
  if not 6<=f['source_frame']<=24:continue
  for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0)
  update();pts=[mapped(p) for p in f['pose_world_landmarks'][0]];tx=pts[24]-pts[23];up=(pts[11]+pts[12]-pts[23]-pts[24])/2;target=frame(tx,up)
  pelvis=arm.pose.bones['pelvis'];basis=(arm.matrix_world@pelvis.matrix).to_quaternion()
  if case!='frozen':
   delta=restx.rotation_difference(tx) if case=='hip_axis' else (target@rest.inverted()).to_quaternion()
   pelvis.rotation_quaternion=basis.inverted()@delta@basis;update()
  angles=[];quats={}
  for n,a,b in [('upper_leg_l',23,25),('lower_leg_l',25,27),('upper_leg_r',24,26),('lower_leg_r',26,28)]:
   bone=arm.pose.bones[n];desired=(pts[b]-pts[a]).normalized();current=(arm.matrix_world@bone.tail-arm.matrix_world@bone.head).normalized();delta=current.rotation_difference(desired);basis=(arm.matrix_world@bone.matrix).to_quaternion();bone.rotation_quaternion=basis.inverted()@delta@basis;update()
   actual=(arm.matrix_world@bone.tail-arm.matrix_world@bone.head).normalized();angles.append(math.degrees(actual.angle(desired)));q=bone.rotation_quaternion;quats[n]=[q.x,q.y,q.z,q.w]
  xyz={}
  for side,s in [('left','l'),('right','r')]:
   for part,b in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:
    q=head(b+'_'+s);xyz[side+'_'+part]=[q.x,-q.z,q.y]
  center=[(xyz['left_hip'][k]+xyz['right_hip'][k])/2 for k in range(3)];xyz={n:[v[k]-center[k] for k in range(3)] for n,v in xyz.items()}
  hipangle=math.degrees((head('upper_leg_r')-head('upper_leg_l')).angle(tx));q=pelvis.rotation_quaternion
  rows.append({'case':case,'source_frame':f['source_frame'],'target_frame_determinant':target.determinant(),'hip_axis_error_deg':hipangle,'leg_direction_max_error_deg':max(angles),'xyz_right_down_forward':xyz,'pelvis_xyzw':[q.x,q.y,q.z,q.w],'leg_quaternions':quats})
  assert max(angles)<.1
  if case!='frozen':assert hipangle<.1,(case,f['source_frame'],hipangle)
(P/'pelvis-control.json').write_text(json.dumps({'rig_sha256':hashlib.sha256(RIG.read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'rest_frame_determinant':rest.determinant(),'rows':rows,'limits':['World axes mapping remains diagnostic','Source torso up is model estimate','Root fixed, leg directions recomputed for every case','No new camera orientation, rig proportions or contact fit']},indent=2))
print('PELVIS_CONTROL_COMPLETE')
