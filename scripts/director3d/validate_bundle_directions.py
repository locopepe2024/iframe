"""Compare source landmark directions with evaluated Blender pose directions.

This is a diagnostic only. It does not mutate the source blend on disk.
"""
import argparse, json, math
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector

PAIRS = {
    "pelvis": ("left_hip", "right_hip"),
    "upper_leg_l": ("left_hip", "left_knee"), "lower_leg_l": ("left_knee", "left_ankle"),
    "upper_leg_r": ("right_hip", "right_knee"), "lower_leg_r": ("right_knee", "right_ankle"),
    "foot_l": ("left_heel", "left_foot_index"), "foot_r": ("right_heel", "right_foot_index"),
    "upper_arm_l": ("left_shoulder", "left_elbow"), "lower_arm_l": ("left_elbow", "left_wrist"),
    "upper_arm_r": ("right_shoulder", "right_elbow"), "lower_arm_r": ("right_elbow", "right_wrist"),
}

def dot(a,b): return sum(x*y for x,y in zip(a,b))
def norm(v):
    n = math.sqrt(dot(v,v)); return [x/n for x in v] if n > 1e-8 else None
def angle(a,b):
    a,b=norm(a),norm(b)
    if not a or not b: return None
    return math.degrees(math.acos(max(-1,min(1,dot(a,b)))))
def rotate(q,v):
    q=Quaternion((q[3],q[0],q[1],q[2])); return list(q @ Vector(v))

def main():
    import sys; raw=sys.argv[sys.argv.index("--")+1:]
    ap=argparse.ArgumentParser(); ap.add_argument('--bundle',required=True); ap.add_argument('--track',required=True); ap.add_argument('--source-blend',required=True); ap.add_argument('--frames',default='1,95,187'); args=ap.parse_args(raw)
    bundle=json.loads(Path(args.bundle).read_text()); track=json.loads(Path(args.track).read_text())
    bpy.ops.wm.open_mainfile(filepath=args.source_blend)
    arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
    by_frame={int(f['frame']):f for f in bundle['frames']}
    track_frames=track['frames']
    # Bundle frame numbers are timestamp-derived; use nearest source frame by timestamp.
    for frame in [int(x) for x in args.frames.split(',')]:
        data=by_frame.get(frame)
        if not data: continue
        for name,value in {**(data.get('localQuaternions') or {}), 'pelvis':data.get('pelvisQuaternion')}.items():
            if value and arm.pose.bones.get(name):
                b=arm.pose.bones[name]; b.rotation_mode='QUATERNION'; b.rotation_quaternion=Quaternion((value[3],value[0],value[1],value[2]))
        bpy.context.scene.frame_set(frame); bpy.context.view_layer.update()
        # Match by timestamp-derived frame number.
        src=min(track_frames,key=lambda s: abs((round(float(s.get('source_timestamp_seconds',0))*bundle['fps'])+1)-frame))
        joints=src.get('semantic_joints',{})
        print(json.dumps({'frame':frame,'source_index':track_frames.index(src),'bones':[
            {'bone':name,'source_angle_error_deg':angle(rotate([-math.sqrt(.5),0,0,math.sqrt(.5)],[joints[end][i]-joints[start][i] for i in range(3)]), list((arm.matrix_world @ arm.pose.bones[name].tail)-(arm.matrix_world @ arm.pose.bones[name].head)))}
            for name,(start,end) in PAIRS.items() if name in arm.pose.bones and start in joints and end in joints
        ]},ensure_ascii=False))
if __name__=='__main__': main()
