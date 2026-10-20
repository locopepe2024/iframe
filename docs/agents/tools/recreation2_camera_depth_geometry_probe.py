"""Read-only depth geometry and exact pinhole projection from frozen pose."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
import render_full_motion_bundle as renderer
p=argparse.ArgumentParser()
for k in ('rig','track','anchors','bundle','out'):p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
t={f['source_frame']:f['semantic_joints'] for f in json.loads(Path(a.track).read_text())['frames']}
anchors={f['source_frame']:f['new_bundle_frame'] for f in json.loads(Path(a.anchors).read_text()) if f.get('kind')!='hold_until_next_pts'}
bundle=json.loads(Path(a.bundle).read_text());bpy.ops.wm.open_mainfile(filepath=a.rig)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
if arm.animation_data:arm.animation_data_clear()
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
root=bpy.data.objects.new('director-motion-root',None);bpy.context.collection.objects.link(root);arm.parent=root
renderer.setup_scene(bundle,Path(a.out).parent);renderer.apply_bundle(bundle,arm)
parts={'hip':'upper_leg','knee':'lower_leg','ankle':'ankle','shoulder':'upper_arm','elbow':'lower_arm','wrist':'wrist'}
def project(v):
 q=world_to_camera_view(bpy.context.scene,bpy.context.scene.camera,v);return Vector((q.x*640,(1-q.y)*360))
def angle(u,v):return math.degrees(math.acos(max(-1,min(1,u.normalized().dot(v.normalized())))))
r={'schema':'recreation2-camera-depth-geometry.v1','sha256':{k:hashlib.sha256(Path(v).read_bytes()).hexdigest() for k,v in [('rig',a.rig),('track',a.track),('anchors',a.anchors),('bundle',a.bundle),('probe',__file__)]},'rows':[]}
for sf in (1,17,23,29,41,55):
 bpy.context.scene.frame_set(anchors[sf]);bpy.context.view_layer.update()
 cam=bpy.context.scene.camera;inv=cam.matrix_world.inverted();rot=cam.matrix_world.to_quaternion()
 right,up,forward=[rot@Vector(v) for v in ((1,0,0),(0,1,0),(0,0,-1))]
 # Calibrate pixel focal and principal point from camera-space unit points.
 origin=cam.matrix_world@Vector((0,0,-1));center=project(origin)
 fx=(project(cam.matrix_world@Vector((1,0,-1)))-center).x
 fy=-(project(cam.matrix_world@Vector((0,1,-1)))-center).y
 assert cam.data.type=='PERSP'
 r['camera_intrinsics_px']={'fx':fx,'fy':fy,'principal_point':list(center)}
 def camera_coords(v):
  q=inv@v;return Vector((q.x,-q.y,-q.z))
 def pinhole(q):return Vector((center.x+fx*q.x/q.z,center.y+fy*q.y/q.z))
 def head(key):
  side,part=key.split('_',1);return arm.matrix_world@arm.pose.bones[parts[part]+'_'+('l' if side=='left' else 'r')].head
 pairs=[(f'{side}_{start}',f'{side}_{end}') for side in ('left','right') for start,end in [('shoulder','elbow'),('elbow','wrist'),('hip','knee'),('knee','ankle')]]+[('left_hip','right_hip'),('left_shoulder','right_shoulder')]
 for ka,kb in pairs:
  start,end=head(ka),head(kb);qs,qe=camera_coords(start),camera_coords(end)
  actual=end-start;delta=Vector(t[sf][kb])-Vector(t[sf][ka]);scaled=Vector((delta.x,delta.y*792/1394,delta.z))
  target=(right*scaled.x-up*scaled.y+forward*scaled.z).normalized();ideal=start+target*actual.length
  sp=Vector((delta.x*640,delta.y*360));ap=project(end)-project(start);ip=project(ideal)-project(start)
  exact=pinhole(qe)-pinhole(qs);err=(exact-ap).length;assert err<.001,(sf,ka,err)
  r['rows'].append({'source_frame':sf,'segment':ka+'__'+kb,'start_camera_xyz_right_down_forward':list(qs),'end_camera_xyz_right_down_forward':list(qe),
    'rig_world_length':actual.length,'source_scaled_proxy_length':scaled.length,
    'rig_signed_depth_fraction':(qe.z-qs.z)/actual.length,'source_signed_depth_fraction':scaled.z/scaled.length,
    'rig_target_direction_angle_deg':angle(actual,target),'source_screen_length_px':sp.length,'rig_screen_length_px':ap.length,'rig_source_length_ratio':ap.length/sp.length,
    'same_length_target_screen_length_px':ip.length,'same_length_target_source_length_ratio':ip.length/sp.length,
    'rig_screen_direction_error_deg':angle(ap,sp),'target_screen_direction_error_deg':angle(ip,sp),'exact_projection_difference_px':err})
Path(a.out).parent.mkdir(parents=True,exist_ok=True);Path(a.out).write_text(json.dumps(r,indent=2)+'\n');print('CAMERA_DEPTH_GEOMETRY_COMPLETE')
