import argparse,hashlib,json
from pathlib import Path

def file_info(path):
 p=Path(path)
 h=hashlib.sha256();
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
 return {'path':str(p),'filename':p.name,'sha256':h.hexdigest(),'bytes':p.stat().st_size}
def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--track',required=True); ap.add_argument('--validation',required=True); ap.add_argument('--review-image',required=True); ap.add_argument('--blender-state',required=True); ap.add_argument('--blender-manifest'); ap.add_argument('--source-video',required=True); ap.add_argument('--out',required=True); args=ap.parse_args()
 track=json.loads(Path(args.track).read_text()); validation=json.loads(Path(args.validation).read_text()); state=json.loads(Path(args.blender_state).read_text());
 files={'source_video':file_info(args.source_video),'motion_track':file_info(args.track),'validation':file_info(args.validation),'review_image':file_info(args.review_image),'blender_state':file_info(args.blender_state)}
 if args.blender_manifest: files['blender_manifest']=file_info(args.blender_manifest)
 summary=validation.get('summary',{})
 bundle={'schema':'motion-review-bundle.v1','bundle_id':'motion-review-'+track.get('target_selection',{}).get('target_subject_id','unknown'),'source':{'schema':track.get('schema'),'media':files['source_video'],'fps':track.get('source',{}).get('fps'),'width':track.get('source',{}).get('width'),'height':track.get('source',{}).get('height')},'target':{'subject_id':track.get('target_selection',{}).get('target_subject_id'),'selection_policy':track.get('target_selection',{}).get('policy'),'tracked_frames':summary.get('tracked_frames'),'occluded_frames':summary.get('occluded_frames'),'tracked_ratio':summary.get('tracked_ratio'),'occluded_ranges_source_frames':summary.get('occluded_ranges_source_frames',[])},'artifacts':files,'blender':state.get('motion_track_source',{}),'review_status':'needs_director_review','evidence_boundary':{'proven':'artifact_identity_and_track_structure','not_proven':['3d_pose_accuracy','provider_motion_control_effect','identity_replacement_quality']}}
 Path(args.out).write_text(json.dumps(bundle,ensure_ascii=False,indent=2)); print(json.dumps({'out':args.out,'files':len(files),'status':bundle['review_status']}))
if __name__=='__main__': main()
