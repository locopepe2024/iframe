"""Build a review bundle for torso, arms, legs and feet in evaluated Blender space."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Matrix,Quaternion,Vector

BASIS=Quaternion((math.sqrt(.5),-math.sqrt(.5),0,0))
PAIRS={'upper_leg_l':('left_hip','left_knee'),'lower_leg_l':('left_knee','left_ankle'),'upper_leg_r':('right_hip','right_knee'),'lower_leg_r':('right_knee','right_ankle'),'foot_l':('left_heel','left_foot_index'),'foot_r':('right_heel','right_foot_index'),'upper_arm_l':('left_shoulder','left_elbow'),'lower_arm_l':('left_elbow','left_wrist'),'wrist_l':('left_elbow','left_wrist'),'upper_arm_r':('right_shoulder','right_elbow'),'lower_arm_r':('right_elbow','right_wrist'),'wrist_r':('right_elbow','right_wrist')}
ORDER=['spine_lower','spine_mid','spine_chest','clavicle_l','clavicle_r','upper_arm_l','lower_arm_l','wrist_l','upper_arm_r','lower_arm_r','wrist_r','upper_leg_l','lower_leg_l','foot_l','upper_leg_r','lower_leg_r','foot_r']
SPINE_WEIGHTS={'spine_lower':0.35,'spine_mid':0.65,'spine_chest':1.0}
def vec(j,a,b):
 v=BASIS@Vector([j[b][i]-j[a][i] for i in range(3)]);return v.normalized() if v.length>1e-8 else None
def clavicle(j,side):
 side = {'l':'left','r':'right'}.get(side, side)
 shoulder_center=Vector([(j['left_shoulder'][i]+j['right_shoulder'][i])/2 for i in range(3)])
 shoulder=Vector(j[f'{side}_shoulder'])
 v=BASIS@(shoulder-shoulder_center)
 return v.normalized() if v.length>1e-8 else None
def torso(j):
 h=Vector([(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)]);s=Vector([(j['left_shoulder'][i]+j['right_shoulder'][i])/2 for i in range(3)]);v=BASIS@(s-h);return v.normalized() if v.length>1e-8 else None
def pelvis_target(j):
 if not all(k in j for k in ('left_hip','right_hip','left_shoulder','right_shoulder')): return None
 h=Vector([(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)]);s=Vector([(j['left_shoulder'][i]+j['right_shoulder'][i])/2 for i in range(3)])
 up=(BASIS@(s-h)).normalized();right=(BASIS@Vector([j['right_hip'][i]-j['left_hip'][i] for i in range(3)])).normalized();forward=right.cross(up).normalized();right=up.cross(forward).normalized()
 return Matrix(((right.x,forward.x,up.x),(right.y,forward.y,up.y),(right.z,forward.z,up.z))).to_quaternion()
def proxy_spine_targets(proxy):
 if not proxy or not proxy.get('points'): return {}
 points=proxy['points']
 pairs={'spine_lower':('pelvis','spine_lower'),'spine_mid':('spine_lower','spine_mid'),'spine_chest':('spine_mid','spine_chest')}
 result={}
 for name,(a,b) in pairs.items():
  if a not in points or b not in points: continue
  v=BASIS@Vector([points[b][i]-points[a][i] for i in range(3)])
  if v.length>1e-8: result[name]=v.normalized()
 return result
def spine_target(name,torso_direction,rest_direction):
 weight=SPINE_WEIGHTS[name];target=rest_direction.lerp(torso_direction,weight)
 return target.normalized() if target.length>1e-8 else torso_direction
def wd(arm,p):return ((arm.matrix_world@p.tail)-(arm.matrix_world@p.head)).normalized()
def qxyzw(q):return [q.x,q.y,q.z,q.w]
raw=sys.argv[sys.argv.index('--')+1:];ap=argparse.ArgumentParser();ap.add_argument('--track',required=True);ap.add_argument('--source-blend',required=True);ap.add_argument('--out',required=True);ap.add_argument('--fps',type=float,default=24);ap.add_argument('--torso-proxy');ap.add_argument('--enable-pelvis-orientation',action='store_true');args=ap.parse_args(raw)
t=json.loads(Path(args.track).read_text());proxy_by_frame={}
if args.torso_proxy:
 proxy_data=json.loads(Path(args.torso_proxy).read_text())
 proxy_by_frame={item.get('frame'):item for item in proxy_data.get('frames',[])}
bpy.ops.wm.open_mainfile(filepath=args.source_blend);arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0];frames=[]
for src in t['frames']:
 f=max(1,round(float(src.get('source_timestamp_seconds',0))*args.fps)+1);j=src.get('semantic_joints',{});bpy.context.scene.frame_set(f)
 for p in arm.pose.bones:p.rotation_mode='QUATERNION';p.rotation_quaternion=Quaternion((1,0,0,0))
 bpy.context.view_layer.update();qs={};warn=[];up=torso(j) if all(k in j for k in ('left_hip','right_hip','left_shoulder','right_shoulder')) else None;segmented=proxy_spine_targets(proxy_by_frame.get(src.get('frame')));pelvis_q=None
 pelvis=arm.pose.bones.get('pelvis');target_pelvis=pelvis_target(j) if args.enable_pelvis_orientation else None
 if pelvis and target_pelvis:
  current_pelvis=(arm.matrix_world@pelvis.matrix).to_quaternion();world_delta=current_pelvis.rotation_difference(target_pelvis);parent=pelvis.parent;basis=(arm.matrix_world@parent.matrix).to_quaternion() if parent else arm.matrix_world.to_quaternion();pelvis.rotation_quaternion=basis.inverted()@world_delta@basis;bpy.context.view_layer.update();pelvis_q=qxyzw(pelvis.rotation_quaternion)
 for name in ORDER:
  p=arm.pose.bones.get(name);rest=wd(arm,p) if p else None
  target=segmented.get(name) or (spine_target(name,up,rest) if name.startswith('spine_') and up and rest else (clavicle(j,name[-1]) if name.startswith('clavicle_') and all(k in j for k in ('left_shoulder','right_shoulder')) else (vec(j,*PAIRS[name]) if name in PAIRS and PAIRS[name][0] in j and PAIRS[name][1] in j else None)))
  if not p or not target: warn.append('missing '+name);continue
  current=wd(arm,p);world_delta=current.rotation_difference(target);parent=p.parent;basis=(arm.matrix_world@parent.matrix).to_quaternion() if parent else arm.matrix_world.to_quaternion()
  if name.startswith('upper_arm_') or name.startswith('upper_leg_'):basis=(arm.matrix_world@p.matrix).to_quaternion()
  p.rotation_quaternion=basis.inverted()@world_delta@basis;bpy.context.view_layer.update();qs[name]=qxyzw(p.rotation_quaternion)
  if f==1 and name.startswith('spine_'):print(json.dumps({'debug':name,'current':list(current),'target':list(target),'delta_angle_deg':math.degrees(world_delta.angle),'local_angle_deg':math.degrees(p.rotation_quaternion.angle),'evaluated':list(wd(arm,p))}))
 root=None
 if 'left_hip' in j and 'right_hip' in j:
  h=[(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)];root=[(h[0]-.5)*2.4,max(-.35,min(.35,-h[2]*1.5)),(1-h[1])*1.8-.9]
 frames.append({'frame':f,'rootPosition':root,'pelvisQuaternion':pelvis_q,'localQuaternions':qs,'footContacts':[],'ik':{'left':None,'right':None},'warnings':warn})
d={x['frame']:x for x in frames};out={'schema':'director-full-motion-bundle.v1','source_track_revision':t.get('source_revision'),'retarget_mode':'evaluated_full_body_direction_v1','ik_enabled':False,'cleanup_processors':[],'frame_range':[1,max(d) if d else 1],'fps':args.fps,'coordinate_system':t['coordinate_system'],'warnings':['source depth is MediaPipe proxy; IK disabled','neck and head channels require source landmarks'],'review_status':'needs_director_review','frames':[d[k] for k in sorted(d)],'ik_statuses':[],'request_id':'recreation2-full-body'}
Path(args.out).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'frames':len(out['frames']),'frame_range':out['frame_range']}))
