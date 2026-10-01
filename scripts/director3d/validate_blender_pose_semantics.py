"""Probe Blender pose-bone rotation semantics against rest matrices."""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

def direction(arm, bone):
    return ((arm.matrix_world @ bone.tail) - (arm.matrix_world @ bone.head)).normalized()
def angle(a,b): return math.degrees(a.angle(b))

raw=sys.argv[sys.argv.index('--')+1:]; ap=argparse.ArgumentParser(); ap.add_argument('--source-blend',required=True); ap.add_argument('--bones',default='upper_leg_l,lower_leg_l,pelvis'); args=ap.parse_args(raw)
bpy.ops.wm.open_mainfile(filepath=args.source_blend); arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
for name in args.bones.split(','):
    pb=arm.pose.bones.get(name); eb=arm.data.bones.get(name)
    if not pb or not eb: continue
    bpy.context.scene.frame_set(1); pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=Quaternion((1,0,0,0)); bpy.context.view_layer.update()
    rest=direction(arm,pb)
    q=Quaternion((math.cos(math.radians(15)),math.sin(math.radians(15)),0,0))
    pb.rotation_quaternion=q; bpy.context.view_layer.update(); actual=direction(arm,pb)
    local_y=Vector((0,1,0));
    c1=(arm.matrix_world @ (eb.matrix_local @ (q @ local_y))).normalized()
    c2=(arm.matrix_world.to_quaternion() @ (eb.matrix_local.to_quaternion() @ (q @ local_y))).normalized()
    print(json.dumps({'bone':name,'rest_dir':list(rest),'actual_dir':list(actual),'candidate_matrix_local_q_error_deg':angle(actual,c1),'candidate_quat_order_error_deg':angle(actual,c2)}))
