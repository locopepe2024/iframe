import argparse,json,sys
from pathlib import Path

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('track'); ap.add_argument('--out'); args=ap.parse_args()
 p=json.loads(Path(args.track).read_text()); errors=[]; warnings=[]; fs=p.get('frames',[]); src=p.get('source',{})
 if p.get('schema')!='motion-track.v1': errors.append('schema must be motion-track.v1')
 prev=0; tracked=0; occluded=0; ranges=[]; start=None; frame_numbers=[]
 for f in fs:
  n=int(f.get('frame',0));
  if n<=prev: errors.append(f'non_monotonic_frame:{n}')
  prev=n
  frame_numbers.append(n)
  st=f.get('selection_status')
  if st=='tracked':
   tracked+=1
   b=f.get('target_bbox')
   if not isinstance(b,list) or len(b)!=4 or any(not isinstance(x,(int,float)) or x<0 or x>1 for x in b): errors.append(f'invalid_bbox:{n}')
   if b and (b[2]<b[0] or b[3]<b[1]): errors.append(f'inverted_bbox:{n}')
   if not f.get('target_landmarks'): warnings.append(f'missing_landmarks_for_tracked:{n}')
  elif st=='occluded':
   occluded+=1
   if f.get('target_landmarks') is not None: warnings.append(f'landmarks_present_for_occluded:{n}')
   if start is None: start=n
  elif st in {'detector_missed','out_of_frame','identity_unresolved','pending'}:
   if f.get('target_landmarks') is not None: warnings.append(f'landmarks_present_for_unresolved:{n}')
  else: errors.append(f'unknown_selection_status:{n}')
  if st!='occluded' and start is not None: ranges.append([start,frame_numbers[-2] if len(frame_numbers)>1 else start]); start=None
 if start is not None: ranges.append([start,frame_numbers[-1]])
 count=len(fs); ratio=tracked/count if count else 0
 if count==0: errors.append('frames_empty')
 if ratio<0.6: warnings.append('tracked_ratio_below_0.6')
 diffs=[b-a for a,b in zip(frame_numbers,frame_numbers[1:]) if b>a]
 sample_step=round(sorted(diffs)[len(diffs)//2],3) if diffs else None
 result={'valid':not errors,'errors':errors,'warnings':warnings,'summary':{'frames':count,'tracked_frames':tracked,'occluded_frames':occluded,'tracked_ratio':round(ratio,4),'occluded_ranges_source_frames':ranges,'sample_step_source_frames':sample_step,'fps':src.get('fps'),'width':src.get('width'),'height':src.get('height')}}
 print(json.dumps(result,ensure_ascii=False,indent=2))
 if args.out: Path(args.out).write_text(json.dumps(result,ensure_ascii=False,indent=2))
 return 0 if not errors else 2
if __name__=='__main__': sys.exit(main())
