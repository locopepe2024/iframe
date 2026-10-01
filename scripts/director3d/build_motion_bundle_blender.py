"""Build a review bundle by solving directions in Blender's evaluated pose space."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Quaternion,Vector,Matrix

PAIRS={'upper_leg_l':('left_hip','left_knee'),'lower_leg_l':('left_knee','left_ankle'),'upper_leg_r':('right_hip','right_knee'),'lower_leg_r':('right_knee','right_ankle'),'foot_l':('left_heel','left_foot_index'),'foot_r':('right_heel','right_foot_index')}
ORDER=['upper_leg_l','lower_leg_l','foot_l','upper_leg_r','lower_leg_r','foot_r']
BASIS=Quaternion((math.sqrt(.5),0,0,math.sqrt(.5)))
def source_dir(j,a,b):
 v=BASIS@Vector([j[b][i]-j[a][i] for i in range(3)]); return v.normalized() if v.length>1e-8 else None
def world_dir(arm,pb): return ((arm.matrix_world@pb.tail)-(arm.matrix_world@pb.head)).normalized()
def xyzw(q): return [q.x,q.y,q.z,q.w]
def main():
 raw=sys.argv[sys.argv.index('--')+1:];ap=argparse.ArgumentParser();ap.add_argument('--track',required=True);ap.add_argument('--source-blend',required=True);ap.add_argument('--out',required=True);ap.add_argument('--fps',type=float,default=24);args=ap.parse_args(raw)
 track=json.loads(Path(args.track).read_text());bpy.ops.wm.open_mainfile(filepath=args.source_blend);arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0];frames=[]
 for src in track['frames']:
  frame=max(1,round(float(src.get('source_timestamp_seconds',0))*args.fps)+1);j=src.get('semantic_joints',{});bpy.context.scene.frame_set(frame)
  for pb in arm.pose.bones: pb.rotation_mode='QUATERNION';pb.rotation_quaternion=Quaternion((1,0,0,0))
  bpy.context.view_layer.update();quats={};warnings=[]
  if all(k in j for k in ('left_hip','right_hip','left_shoulder','right_shoulder')):
   pb=arm.pose.bones.get('pelvis');hc=Vector([(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)]);sc=Vector([(j['left_shoulder'][i]+j['right_shoulder'][i])/2 for i in range(3)]);up=(BASIS@(sc-hc)).normalized();right=(BASIS@Vector([j['right_hip'][i]-j['left_hip'][i] for i in range(3)])).normalized();forward=right.cross(up).normalized();right=up.cross(forward).normalized();target=Matrix(((right.x,forward.x,up.x),(right.y,forward.y,up.y),(right.z,forward.z,up.z))).to_quaternion();basis=(arm.matrix_world@pb.matrix).to_quaternion();pb.rotation_quaternion=basis.inverted()@(target@basis.inverted())@basis;bpy.context.view_layer.update();quats['pelvis']=xyzw(pb.rotation_quaternion)
  for name in ORDER:
   pb=arm.pose.bones.get(name);pair=PAIRS[name]
   if not pb or pair[0] not in j or pair[1] not in j: warnings.append('missing '+name);continue
   target=source_dir(j,*pair);wd=world_dir(arm,pb);basis=(arm.matrix_world@pb.matrix).to_quaternion();pb.rotation_quaternion=basis.inverted()@(wd.rotation_difference(target))@basis;bpy.context.view_layer.update();quats[name]=xyzw(pb.rotation_quaternion)
  root=None
  if 'left_hip' in j and 'right_hip' in j:
   hips=[(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)];root=[(hips[0]-.5)*2.4,max(-.35,min(.35,-hips[2]*1.5)),(1-hips[1])*1.8-.9]
  frames.append({'frame':frame,'rootPosition':root,'pelvisQuaternion':quats.pop('pelvis',None),'localQuaternions':quats,'footContacts':[],'ik':{'left':None,'right':None},'warnings':warnings})
 dedup={f['frame']:f for f in frames};out={'schema':'director-full-motion-bundle.v1','source_track_revision':track.get('source_revision'),'retarget_mode':'evaluated_pose_direction_v1','ik_enabled':False,'cleanup_processors':[],'frame_range':[1,max(dedup) if dedup else 1],'fps':args.fps,'coordinate_system':track['coordinate_system'],'warnings':['source depth is MediaPipe proxy; IK disabled','spine and arm channels not included'],'review_status':'needs_director_review','frames':[dedup[k] for k in sorted(dedup)],'ik_statuses':[],'request_id':'recreation2-evaluated-direction'}
 Path(args.out).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'frames':len(out['frames']),'frame_range':out['frame_range']}))
if __name__=='__main__':main()
