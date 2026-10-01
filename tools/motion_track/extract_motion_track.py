import argparse
import json
from pathlib import Path
import cv2
import mediapipe as mp

POSE_CONNECTIONS = tuple(mp.tasks.vision.PoseLandmarksConnections.POSE_LANDMARKS)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--video', required=True); ap.add_argument('--model', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--max-frames', type=int, default=240); ap.add_argument('--sample-every', type=int, default=1)
    args=ap.parse_args()
    cap=cv2.VideoCapture(args.video)
    if not cap.isOpened(): raise SystemExit('cannot open video')
    fps=cap.get(cv2.CAP_PROP_FPS) or 30.0; width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    out=Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    overlay_path=out.with_suffix('.overlay.mp4'); json_path=out.with_suffix('.json')
    writer=cv2.VideoWriter(str(overlay_path), cv2.VideoWriter_fourcc(*'mp4v'), fps/max(1,args.sample_every), (width,height))
    options=mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=args.model),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=3,
        min_pose_detection_confidence=0.35,
        min_pose_presence_confidence=0.35,
        min_tracking_confidence=0.35,
        output_segmentation_masks=False,
    )
    tracks=[]; frame_no=0; processed=0; previous_bbox=None; previous_center=None; previous_previous_center=None
    with mp.tasks.vision.PoseLandmarker.create_from_options(options) as landmarker:
      while processed < args.max_frames:
        ok, frame=cap.read()
        if not ok: break
        frame_no += 1
        if (frame_no-1) % max(1,args.sample_every): continue
        rgb=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result=landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int((frame_no-1)*1000/fps))
        candidates=[]
        for pose_idx, pose in enumerate(result.pose_landmarks):
          pts=[(float(lm.x),float(lm.y),float(lm.z),float(lm.visibility or 0.0)) for lm in pose]
          valid=[p for p in pts if 0 <= p[0] <= 1 and 0 <= p[1] <= 1]
          if not valid: continue
          xs=[p[0] for p in valid]; ys=[p[1] for p in valid]
          bbox=[min(xs),min(ys),max(xs),max(ys)]
          center=((bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2)
          candidates.append({'pose_index':pose_idx,'bbox':bbox,'center':center,'landmarks':pts})
        def iou(a, b):
          if not a or not b: return 0.0
          ax0, ay0, ax1, ay1 = a; bx0, by0, bx1, by1 = b
          ix0, iy0, ix1, iy1 = max(ax0,bx0), max(ay0,by0), min(ax1,bx1), min(ay1,by1)
          iw, ih = max(0.0, ix1-ix0), max(0.0, iy1-iy0)
          inter=iw*ih; area_a=max(0.0,ax1-ax0)*max(0.0,ay1-ay0); area_b=max(0.0,bx1-bx0)*max(0.0,by1-by0)
          return inter / max(1e-9, area_a+area_b-inter)
        target=None
        selection_status='detector_missed' if candidates else 'out_of_frame'
        selection_reason='no_candidate_pose' if not candidates else 'identity_unresolved'
        if candidates:
          center_candidates=[c for c in candidates if abs(c['center'][0]-0.5) <= 0.20]
          if previous_bbox is None:
            pool=center_candidates or candidates
            target=min(pool,key=lambda c: abs(c['center'][0]-0.5)+0.25*abs(c['center'][1]-0.5))
          else:
            pool=center_candidates or candidates
            predicted=previous_center
            if previous_center is not None and previous_previous_center is not None:
              predicted=(previous_center[0]+(previous_center[0]-previous_previous_center[0]), previous_center[1]+(previous_center[1]-previous_previous_center[1]))
            def score(c):
              prediction_distance=abs(c['center'][0]-predicted[0])+0.25*abs(c['center'][1]-predicted[1]) if predicted else abs(c['center'][0]-0.5)+0.25*abs(c['center'][1]-0.5)
              continuity=1.0-iou(previous_bbox,c['bbox'])
              return 0.75*prediction_distance+0.25*continuity
            ranked=sorted(pool,key=score)
            if ranked and (len(ranked)==1 or score(ranked[0]) <= score(ranked[1]) * 0.82): target=ranked[0]
          if target is not None:
            previous_previous_center=previous_center; previous_center=target['center']
            previous_bbox=target['bbox']
            selection_status='tracked'
            selection_reason='predicted_center_continuity' if previous_previous_center else 'center_prior'
        tracks.append({'frame':frame_no,'timestamp_seconds':(frame_no-1)/fps,'subject_count':len(candidates),'target_pose_index':target['pose_index'] if target else None,'target_bbox':target['bbox'] if target else None,'target_landmarks':target['landmarks'] if target else None,'target_track_id':'person-center','selection_status':selection_status,'selection_reason':selection_reason,'occlusion_evidence':False,'poses':[{'pose_index':c['pose_index'],'bbox':c['bbox'],'center':c['center']} for c in candidates]})
        for c in candidates:
          color=(0,180,255) if target is c else (130,130,130)
          for x,y,_,_ in c['landmarks']:
            if 0<=x<=1 and 0<=y<=1: cv2.circle(frame,(int(x*width),int(y*height)),3,color,-1)
          x0,y0,x1,y1=c['bbox']; cv2.rectangle(frame,(int(x0*width),int(y0*height)),(int(x1*width),int(y1*height)),color,2)
        cv2.putText(frame,f'frame {frame_no} poses {len(candidates)} target {target["pose_index"] if target else "none"}',(20,40),cv2.FONT_HERSHEY_SIMPLEX,0.8,(0,220,255),2)
        writer.write(frame); processed += 1
    cap.release(); writer.release()
    payload={'schema':'motion-track.v1','source':{'path':args.video,'fps':fps,'width':width,'height':height,'sample_every':args.sample_every,'frames_processed':processed},'target_selection':{'policy':'center_prior_with_predicted_center_continuity','target_subject_id':'person-center','occlusion_is_not_inferred':True},'frames':tracks}
    json_path.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    print(json.dumps({'json':str(json_path),'overlay':str(overlay_path),'frames':processed,'fps':fps,'width':width,'height':height},ensure_ascii=False))
if __name__=='__main__': main()
