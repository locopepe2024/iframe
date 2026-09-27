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
    return math.degrees(math.atan2(b[1]-a[1], b[0]-a[0]))
def point(lms,i):
    if not lms or i>=len(lms): return None
    p=lms[i]
    if len(p)<4 or p[3] < 0.2:return None
    return (p[0],p[1])
def rel_angle(a,b,base=0.0):
    x=angle(a,b)
    return None if x is None else max(-180.0,min(180.0,x-base))
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--track',required=True); ap.add_argument('--out',required=True); ap.add_argument('--fps',type=float,default=None)
    args=ap.parse_args(); src=json.loads(Path(args.track).read_text()); fps=args.fps or float(src['source']['fps']); frames=[]
    for f in src['frames']:
        l=f.get('target_landmarks');
        if f.get('selection_status')!='tracked' or not l: continue
        ls,rs,le,re,lh,rh,lk,rk=[point(lms:=l,i) for i in (L_SHOULDER,R_SHOULDER,L_ELBOW,R_ELBOW,L_HIP,R_HIP,L_KNEE,R_KNEE)]
        center=lambda a,b: ((a[0]+b[0])/2,(a[1]+b[1])/2) if a and b else None
        torso=center(ls,rs); hips=center(lh,rh)
        root=[0.0,0.0,0.0]
        if torso and hips: root=[(torso[0]+hips[0]-1.0)*2.4,0.0,0.0]
        rotations={}
        for name,a,b in [('shoulder_l',ls,le),('shoulder_r',rs,re),('elbow_l',le,point(l,L_WRIST)),('elbow_r',re,point(l,R_WRIST)),('hip_l',lh,lk),('hip_r',rh,rk),('knee_l',lk,point(l,27)),('knee_r',rk,point(l,28))]:
            v=rel_angle(a,b,90.0 if name.endswith(('_l','_r')) else 0.0)
            if v is not None: rotations[name]=[v,0.0,0.0]
        frames.append({'frame':int(f['frame']),'root_position':root,'joint_rotations_deg':rotations,'source_timestamp_seconds':f['timestamp_seconds'],'selection_status':f['selection_status']})
    state={'state_id':'motion-track-blender-adapter-v1','schema_version':'director_reference_state.v1','revision':1,'title':'Center subject motion-track white model','duration_seconds':max(1.0, (src['source']['frames_processed']-1)/fps),'fps':round(fps,6),'reference_frame':max(1,frames[len(frames)//2]['frame'] if frames else 1),'outputs':['director_reference_image','camera_motion_reference_video'],'actors':[{'actor_id':'preserve-left','color':'#3B82F6','pose':'neutral','placement':{'position':[-1.7,0,0]},'trajectory':{'end_position':[-1.7,0,0]}},{'actor_id':'target-center','color':'#F59E0B','pose':'neutral','placement':{'position':[0,0,0]},'trajectory':{'end_position':[0,0,0]},'motion_track':frames},{'actor_id':'preserve-right','color':'#22C55E','pose':'neutral','placement':{'position':[1.7,0,0]},'trajectory':{'end_position':[1.7,0,0]}}],'camera':{'camera_id':'camera-main','preset':'push_in','position':[0,-9.5,4.8],'end_position':[0,-9.5,4.8],'look_at':[0,0,1.25],'fov':50},'motion_track_source':{'schema':src['schema'],'target_subject_id':src['target_selection']['target_subject_id'],'tracked_samples':len(frames),'occluded_samples':sum(f.get('selection_status')!='tracked' for f in src['frames']),'mapping':'2d_landmarks_to_image_plane_joint_angles_v1'}}
    Path(args.out).write_text(json.dumps(state,ensure_ascii=False,indent=2)); print(json.dumps({'out':args.out,'samples':len(frames),'occluded':state['motion_track_source']['occluded_samples']}))
if __name__=='__main__':main()
