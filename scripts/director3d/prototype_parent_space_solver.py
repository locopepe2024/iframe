"""Prototype parent-space direction solver for one or more motion frames."""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

PAIRS={"upper_leg_l":("left_hip","left_knee"),"lower_leg_l":("left_knee","left_ankle"),"upper_leg_r":("right_hip","right_knee"),"lower_leg_r":("right_knee","right_ankle"),"foot_l":("left_heel","left_foot_index"),"foot_r":("right_heel","right_foot_index")}
ORDER=["upper_leg_l","lower_leg_l","foot_l","upper_leg_r","lower_leg_r","foot_r"]
BASIS=Quaternion((-math.sqrt(.5),0,0,math.sqrt(.5)))
def n(v): return v.normalized() if v.length>1e-8 else None
def source_dir(j,a,b): return n(BASIS @ Vector([j[b][i]-j[a][i] for i in range(3)]))
def angle(a,b): return math.degrees(a.angle(b)) if a and b else None
def bone_dir(arm,b):
    return n((arm.matrix_world @ b.tail)-(arm.matrix_world @ b.head))

raw=sys.argv[sys.argv.index('--')+1:]; ap=argparse.ArgumentParser();ap.add_argument('--track',required=True);ap.add_argument('--source-blend',required=True);ap.add_argument('--frames',default='1,95');args=ap.parse_args(raw)
track=json.loads(Path(args.track).read_text()); bpy.ops.wm.open_mainfile(filepath=args.source_blend); arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
by_frame={max(1,round(float(s.get('source_timestamp_seconds',0))*24)+1):s for s in track['frames']}
for frame in [int(x) for x in args.frames.split(',')]:
    src=by_frame.get(frame); 
    if not src: continue
    j=src['semantic_joints']; bpy.context.scene.frame_set(frame)
    for reset in arm.pose.bones:
        reset.rotation_mode='QUATERNION'; reset.rotation_quaternion=Quaternion((1,0,0,0))
    bpy.context.view_layer.update()
    # First orient the pelvis from the torso-up vector. Hip-to-shoulder is a
    # better parent frame for leg channels than the pelvis bone's single axis.
    if all(k in j for k in ('left_hip','right_hip','left_shoulder','right_shoulder')):
        pb=arm.pose.bones.get('pelvis')
        hc=Vector([(j['left_hip'][i]+j['right_hip'][i])/2 for i in range(3)])
        sc=Vector([(j['left_shoulder'][i]+j['right_shoulder'][i])/2 for i in range(3)])
        target=n(BASIS @ (sc-hc)); current=bone_dir(arm,pb)
        pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=current.rotation_difference(target)
        bpy.context.view_layer.update()
    for name in ORDER:
        pb=arm.pose.bones.get(name); target=source_dir(j,*PAIRS[name])
        if not pb or not target: continue
        bpy.context.view_layer.update(); current=bone_dir(arm,pb)
        world_delta=current.rotation_difference(target)
        parent=pb.parent
        parent_rot=(arm.matrix_world.to_quaternion() @ parent.matrix.to_quaternion()) if parent else arm.matrix_world.to_quaternion()
        local_delta=parent_rot.inverted() @ world_delta @ parent_rot
        pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=local_delta
    bpy.context.view_layer.update()
    out=[]
    for name,(a,b) in PAIRS.items():
        if arm.pose.bones.get(name) and a in j and b in j: out.append({'bone':name,'error_deg':angle(source_dir(j,a,b),bone_dir(arm,arm.pose.bones[name]))})
    print(json.dumps({'frame':frame,'bones':out}))
