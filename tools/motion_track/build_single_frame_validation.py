"""Build representative single-frame validation cases for Blender retargeting."""
import argparse, json, subprocess
from pathlib import Path

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--video',required=True); ap.add_argument('--track',required=True); ap.add_argument('--output',required=True); ap.add_argument('--frames',default='1,60,120,150,180,240,360,480,556'); args=ap.parse_args()
    out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
    track=json.loads(Path(args.track).read_text()); by={int(f['frame']):f for f in track.get('frames',[])}
    if not track.get('source_revision'): raise SystemExit('source_revision is required')
    selected=[]
    for raw in args.frames.split(','):
        frame=int(raw); item=by.get(frame)
        if not item: raise SystemExit(f'frame {frame} not in source track')
        source_frame=int(item.get('source_frame') or item.get('sourceFrame') or frame)
        image=out/f'frame-{frame:04d}.png'
        subprocess.run(['ffmpeg','-y','-v','error','-i',args.video,'-vf',f"select=eq(n\\,{source_frame-1})",'-frames:v','1',str(image)],check=True)
        selected.append({'frame':frame,'source_frame':source_frame,'timestamp_seconds':item.get('source_timestamp_seconds'),'image':image.name,'semantic_joints':item.get('semantic_joints',{}),'derived_body':item.get('derived_body'),'selection_status':item.get('selection_status')})
    manifest={'schema':'single-frame-motion-validation.v1','source_track_revision':track.get('source_revision'),'source_video':args.video,'cases':selected,'validation_axes':['facing','pelvis','spine','clavicle','upper_arm','upper_leg','foot'],'evidence_boundary':{'not_proven':['temporal_continuity','dynamic_root_yaw','occlusion_recovery']}}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'); print(json.dumps({'cases':len(selected),'output':str(out)}))
if __name__=='__main__': main()
