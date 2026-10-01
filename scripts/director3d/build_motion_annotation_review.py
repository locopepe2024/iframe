"""Create a human-review manifest for target identity and pose gaps."""
import argparse, json
from pathlib import Path

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--track',required=True); ap.add_argument('--out',required=True); args=ap.parse_args()
    data=json.loads(Path(args.track).read_text()); frames=data.get('frames',[]); items=[]; previous=None
    for item in frames:
        landmarks=item.get('target_landmarks'); bbox=item.get('target_bbox'); status=item.get('selection_status','unknown')
        # The extractor's raw output uses target_landmarks/target_bbox, while
        # canonical motion-track.v1 stores semantic_joints and an explicit
        # selection_status. Treat either representation as a tracked frame;
        # otherwise a canonical track is incorrectly reported as fully
        # unresolved.
        canonical_joints=item.get('semantic_joints') or item.get('semanticJoints')
        if (landmarks is not None and bbox is not None) or (status == 'tracked' and canonical_joints):
            if bbox is not None:
                previous={'bbox':bbox,'center':[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2]}
            continue
        candidates=[]
        for pose in item.get('poses',[]):
            pb=pose.get('bbox'); pc=pose.get('center')
            distance=None
            if previous and pc:
                distance=((pc[0]-previous['center'][0])**2+(pc[1]-previous['center'][1])**2)**0.5
            candidates.append({'pose_index':pose.get('pose_index'),'bbox':pb,'center':pc,'distance_to_previous_center':distance})
        items.append({'frame':item.get('frame'),'timestamp_seconds':item.get('timestamp_seconds'),'current_status':status,'suggested_status':'manual_review_required','target_track_id':item.get('target_track_id'),'candidates':candidates,'joint_overrides':{},'reviewer_note':''})
    out={'schema':'motion-track-annotation-review.v1','source_track_revision':data.get('source',{}).get('revision') or data.get('source_revision'),'target_subject_id':data.get('target_selection',{}).get('target_track_id','person-center'),'total_frames':len(frames),'review_required_frames':len(items),'frames':items,'instructions':['Choose a candidate pose or mark out_of_frame/real_occlusion.','Only enter joint_overrides when the source frame visibly contains the target joint.','Do not fabricate poses for out_of_frame frames.']}
    Path(args.out).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'review_required_frames':len(items),'total_frames':len(frames)}))
if __name__=='__main__': main()
