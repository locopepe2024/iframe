"""Offline CPU temporal smoothing for canonical motion-track.v1 joints."""
import argparse, json
from pathlib import Path

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--input',required=True); ap.add_argument('--output',required=True); ap.add_argument('--radius',type=int,default=2); args=ap.parse_args()
    if args.radius < 1: raise SystemExit('--radius must be >= 1')
    data=json.loads(Path(args.input).read_text()); frames=data.get('frames',[])
    out=[]
    for i, frame in enumerate(frames):
        joints=dict(frame.get('semantic_joints',{})); smoothed={}
        for joint, point in joints.items():
            samples=[]
            for k in range(max(0,i-args.radius),min(len(frames),i+args.radius+1)):
                candidate=frames[k].get('semantic_joints',{}).get(joint)
                if candidate is not None: samples.append(candidate)
            if samples: smoothed[joint]=[sum(p[d] for p in samples)/len(samples) for d in range(3)]
        updated=dict(frame); updated['raw_semantic_joints']=joints; updated['semantic_joints']=smoothed; updated['smoothing_applied']={'method':'symmetric_moving_average','radius_frames':args.radius}
        out.append(updated)
    result=dict(data); result['frames']=out; result['smoothing']={'method':'symmetric_moving_average','radius_frames':args.radius,'raw_track_preserved':True}
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'frames':len(out),'radius':args.radius}))
if __name__=='__main__': main()
