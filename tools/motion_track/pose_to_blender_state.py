import argparse,json,math
from pathlib import Path


# MediaPipe Pose landmark indices.
L_SHOULDER,R_SHOULDER=11,12
L_ELBOW,R_ELBOW=13,14
L_WRIST,R_WRIST=15,16
L_HIP,R_HIP=23,24
L_KNEE,R_KNEE=25,26

def angle(a,b):
    if not a or not b:return None
    # Image y grows downward; Blender X/Z pose plane uses z upward.
    return math.degrees(math.atan2(-(b[1]-a[1]), b[0]-a[0]))
def point(lms,i):
    if not lms or i>=len(lms): return None
    p=lms[i]
    if len(p)<4 or p[3] < 0.2:return None
    return (p[0],p[1],p[2] if len(p) > 2 else 0.0)
def rel_angle(a,b,base=0.0):
    x=angle(a,b)
    return None if x is None else (x-base+180.0)%360.0-180.0
def direction(a,b):
    """Return the source segment direction in the adapter's X/Y/Z frame.

    This is deliberately additive to the legacy Euler angle.  It gives the
    later quaternion retargeter the measured vector instead of forcing it to
    reconstruct a vector from a single angle.
    """
    if not a or not b:
        return None
    dx=float(b[0])-float(a[0])
    dz=-(float(b[1])-float(a[1]))
    length=math.sqrt(dx*dx+dz*dz)
    if length < 1e-6:
        return None
    return [dx/length, 0.0, dz/length]

def _interpolate_samples(samples, total_frames):
    """Fill detector gaps and reject obvious center-track jumps."""
    if not samples:
        return []
    by_frame = {int(item["frame"]): item for item in samples}
    known = sorted(by_frame)
    out = []
    for frame in range(1, total_frames + 1):
        if frame in by_frame:
            item = dict(by_frame[frame])
            item["selection_status"] = "tracked"
            out.append(item)
            continue
        before = max((n for n in known if n < frame), default=known[0])
        after = min((n for n in known if n > frame), default=known[-1])
        left, right = by_frame[before], by_frame[after]
        t = 0.0 if after == before else (frame - before) / (after - before)
        rotations = {}
        for name in set(left["joint_rotations_deg"]) | set(right["joint_rotations_deg"]):
            lv = left["joint_rotations_deg"].get(name, right["joint_rotations_deg"].get(name, [0, 0, 0]))
            rv = right["joint_rotations_deg"].get(name, lv)
            rotations[name] = [float(a) + (float(b) - float(a)) * t for a, b in zip(lv, rv)]
        vectors = {}
        for name in set(left.get("joint_vectors", {})) | set(right.get("joint_vectors", {})):
            lv = left.get("joint_vectors", {}).get(name, right.get("joint_vectors", {}).get(name, [0, 0, 0]))
            rv = right.get("joint_vectors", {}).get(name, lv)
            raw = [float(a) + (float(b) - float(a)) * t for a, b in zip(lv, rv)]
            length = math.sqrt(sum(x*x for x in raw))
            vectors[name] = [x / length for x in raw] if length > 1e-6 else [0.0, 0.0, 0.0]
        root = [float(a) + (float(b) - float(a)) * t for a, b in zip(left["root_position"], right["root_position"])]
        out.append({"frame": frame, "source_frame": left.get("source_frame", frame),
                    "root_position": root, "joint_rotations_deg": rotations, "joint_vectors": vectors,
                    "body_centers": {name: ([float(a)+(float(b)-float(a))*t for a,b in zip(lv, right.get('body_centers', {}).get(name, lv))] if isinstance(lv,list) else float(lv)+(float(right.get('body_centers', {}).get(name,lv))-float(lv))*t) for name,lv in left.get('body_centers', {}).items()},
                    "source_timestamp_seconds": left.get("source_timestamp_seconds", 0.0),
                    "selection_status": "interpolated"})
    # A center-track detector swap can create a single-frame root spike.
    for index in range(1, len(out) - 1):
        prev_x = out[index - 1]["root_position"][0]
        cur_x = out[index]["root_position"][0]
        next_x = out[index + 1]["root_position"][0]
        if abs(cur_x - prev_x) > 0.45 and abs(next_x - cur_x) > 0.45 and abs(next_x - prev_x) < 0.25:
            out[index]["root_position"][0] = (prev_x + next_x) / 2.0
            out[index]["selection_status"] = "outlier_corrected"
    return out
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--track',required=True); ap.add_argument('--out',required=True); ap.add_argument('--fps',type=float,default=24.0)
    args=ap.parse_args(); src=json.loads(Path(args.track).read_text()); source_fps=float(src['source']['fps']); fps=float(args.fps); frames=[]
    for f in src['frames']:
        l=f.get('target_landmarks');
        if f.get('selection_status')!='tracked' or not l: continue
        ls,rs,le,re,lh,rh,lk,rk=[point(lms:=l,i) for i in (L_SHOULDER,R_SHOULDER,L_ELBOW,R_ELBOW,L_HIP,R_HIP,L_KNEE,R_KNEE)]
        center=lambda a,b: ((a[0]+b[0])/2,(a[1]+b[1])/2) if a and b else None
        torso=center(ls,rs); hips=center(lh,rh)
        root=[0.0,0.0,0.0]
        if torso and hips:
            # MediaPipe image coordinates are x/right, y/down, z/depth.
            # Map the front-facing subject onto Blender X/Z; retain a bounded
            # depth estimate on Y instead of collapsing the body to one axis.
            depth = 0.0
            if ls and rs and lh and rh:
                depth = max(-0.35, min(0.35, -((ls[2] + rs[2] + lh[2] + rh[2]) / 4.0) * 1.5))
            root=[(torso[0]+hips[0]-1.0)*2.4, depth, (1.0-(torso[1]+hips[1]))*1.8-0.9]
        rotations={}
        vectors={}
        # The pelvis and spine are part of the tracked body, not static rig
        # decoration.  Their planar angles provide the missing hip/torso
        # articulation in the legacy Blender reference path.
        hip_line = (lh, rh)
        torso_line = (hips, torso)
        pelvis_angle = rel_angle(*hip_line, 0.0)
        torso_angle = rel_angle(*torso_line, 90.0)
        if pelvis_angle is not None:
            rotations['pelvis'] = [0.0, pelvis_angle, 0.0]
        if torso_angle is not None:
            # Spine bones inherit their parent's rotation.  Split the desired
            # torso angle across the chain and remove the pelvis contribution.
            spine_delta = (torso_angle - (pelvis_angle or 0.0)) / 3.0
            for name in ('spine_lower', 'spine_mid', 'spine_chest'):
                rotations[name] = [0.0, spine_delta, 0.0]
        for name, a, b in [
            ('pelvis', *hip_line),
            ('spine_lower', *torso_line),
            ('spine_mid', *torso_line),
            ('spine_chest', *torso_line),
        ]:
            d = direction(a, b)
            if d is not None:
                vectors[name] = d
        segment_points = [('upper_arm_l',ls,le),('upper_arm_r',rs,re),('lower_arm_l',le,point(l,L_WRIST)),('lower_arm_r',re,point(l,R_WRIST)),('upper_leg_l',lh,lk),('upper_leg_r',rh,rk),('lower_leg_l',lk,point(l,27)),('lower_leg_r',rk,point(l,28))]
        absolute = {}
        for name,a,b in segment_points:
            rest_angle = -90.0 if 'leg' in name else (180.0 if name.endswith('_r') else 0.0)
            v=rel_angle(a,b,rest_angle)
            absolute[name]=v
            parent = name.replace('lower_arm', 'upper_arm').replace('lower_leg', 'upper_leg')
            if name.startswith('lower_') and v is not None and absolute.get(parent) is not None:
                v=(v-absolute[parent]+180.0)%360.0-180.0
            elif name.startswith('upper_leg') and v is not None:
                v=(v-(pelvis_angle or 0.0)+180.0)%360.0-180.0
            elif name.startswith('upper_arm') and v is not None:
                v=(v-(torso_angle or 0.0)+180.0)%360.0-180.0
            if v is not None: rotations[name]=[0.0,v,0.0]
            d=direction(a,b)
            if d is not None: vectors[name]=d
        body_centers = {}
        if torso:
            body_centers['shoulders'] = [float(torso[0]), float(torso[1])]
        if hips:
            body_centers['hips'] = [float(hips[0]), float(hips[1])]
        if lh and rh:
            body_centers['pelvis_width'] = math.sqrt((rh[0]-lh[0])**2 + (rh[1]-lh[1])**2)
        frames.append({'frame':max(1,round(float(f['timestamp_seconds'])*fps)+1),'source_frame':int(f['frame']),'root_position':root,'joint_rotations_deg':rotations,'joint_vectors':vectors,'body_centers':body_centers,'source_timestamp_seconds':f['timestamp_seconds'],'selection_status':f['selection_status']})
    total_frames=max((int(round(float(f.get('timestamp_seconds',0.0))*fps))+1 for f in src['frames']),default=1)
    frames=_interpolate_samples(frames,total_frames)
    source_duration=max((float(f.get('timestamp_seconds',0.0)) for f in src['frames']),default=0.0)
    state={'state_id':'motion-track-blender-adapter-v1','schema_version':'director_reference_state.v1','revision':3,'retarget_mode':'planar_euler_legacy_with_source_vectors','title':'Center subject motion-track white model','duration_seconds':max(1.0, source_duration + 1.0/source_fps),'fps':round(fps,6),'reference_frame':max(1,frames[len(frames)//2]['frame'] if frames else 1),'outputs':['director_reference_image','camera_motion_reference_video'],'actors':[{'actor_id':'preserve-left','color':'#3B82F6','pose':'neutral','placement':{'position':[-1.7,0,0]},'trajectory':{'end_position':[-1.7,0,0]}},{'actor_id':'target-center','color':'#F59E0B','pose':'neutral','placement':{'position':[0,0,0]},'trajectory':{'end_position':[0,0,0]},'motion_track':frames},{'actor_id':'preserve-right','color':'#22C55E','pose':'neutral','placement':{'position':[1.7,0,0]},'trajectory':{'end_position':[1.7,0,0]}}],'camera':{'camera_id':'camera-main','preset':'push_in','position':[0,-9.5,4.8],'end_position':[0,-9.5,4.8],'look_at':[0,0,1.25],'fov':50},'motion_track_source':{'schema':src['schema'],'target_subject_id':src['target_selection']['target_subject_id'],'source_fps':source_fps,'output_fps':fps,'source_duration_seconds':source_duration,'tracked_samples':sum(f.get('selection_status')=='tracked' for f in frames),'interpolated_samples':sum(f.get('selection_status')=='interpolated' for f in frames),'outlier_corrected_samples':sum(f.get('selection_status')=='outlier_corrected' for f in frames),'occluded_samples':sum(f.get('selection_status')!='tracked' for f in src['frames']),'mapping':'2d_landmarks_to_blender_xz_rest_pose_v4_interpolated'
            ,'coordinate_system':{'image_x':'blender_x','image_y':'blender_z','depth_z':'blender_y','joint_rotation_axis':'blender_y'}}}
    Path(args.out).write_text(json.dumps(state,ensure_ascii=False,indent=2)); print(json.dumps({'out':args.out,'samples':len(frames),'occluded':state['motion_track_source']['occluded_samples']}))
if __name__=='__main__':main()
