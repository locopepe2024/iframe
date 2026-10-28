"""Compare all saved detections on four ambiguous frames without selection."""
import json, math, statistics, hashlib
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-duplicate-review'
EDGES=[(5,7),(7,9),(6,8),(8,10),(5,6),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16)]
def main():
 OUT.mkdir(exist_ok=True)
 source=BASE/'addams-pose-media/independent.json'
 data=json.loads(source.read_text());rows=[]
 sheet=Image.new('RGB',(1440,4*290),'#202020')
 for index,f in enumerate([37,38,43,49]):
  row=next(r for r in data['frames'] if r['source_frame']==f)
  image=Image.open(BASE/f'addams-pose-review/frames/frame-{f:03}.jpg').convert('RGB')
  sheet.paste(image.resize((480,260)),(0,index*290+25))
  ImageDraw.Draw(sheet).text((5,index*290+5),f'Frame {f} | source',fill='white')
  boxes=row['boxes_xyxy'];people=row['rtmpose_people'];assert len(boxes)==len(people)==2
  for i,(box,person) in enumerate(zip(boxes,people)):
   canvas=image.copy();draw=ImageDraw.Draw(canvas);xy=[(x/4,y/4) for x,y in person['coco17_xy']]
   draw.rectangle(tuple(v/4 for v in box),outline='#ff9933',width=3)
   for a,b in EDGES:draw.line([xy[a],xy[b]],fill='#33ff77',width=3)
   for j,(x,y) in enumerate(xy):
    draw.ellipse((x-3,y-3,x+3,y+3),fill='#33ff77');draw.text((x+4,y),str(j),fill='white')
   canvas.save(OUT/f'frame-{f:03}-candidate-{i}.jpg')
   sheet.paste(canvas.resize((480,260)),((i+1)*480,index*290+25))
   ImageDraw.Draw(sheet).text(((i+1)*480+5,index*290+5),f'candidate {i} | mean score {statistics.mean(person["scores"]):.3f}',fill='white')
  a,b=boxes
  area=lambda p:max(0,p[2]-p[0])*max(0,p[3]-p[1])
  inter=area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])])
  deltas=[math.dist(x,y)/4 for x,y in zip(people[0]['coco17_xy'],people[1]['coco17_xy'])]
  body=[deltas[j] for j in range(5,17)]
  rows.append({'source_frame':f,'box_iou':inter/(area(a)+area(b)-inter),'smaller_box_containment':inter/min(area(a),area(b)),'body12_mean_disagreement_px':statistics.mean(body),'body12_max_disagreement_px':max(body),'coco17_disagreement_px':deltas,'candidate_mean_scores':[statistics.mean(p['scores']) for p in people]})
 sheet.save(OUT/'contact-sheet.jpg')
 report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'units':'960x520 display pixels, boxes originally3840x2080','rows':rows,'selection':None,'limits':['No manual ground truth','No detector raw scores preserved in input; pose scores are not detector scores','No candidate chosen or discarded','Four selected double-detection frames only']}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(rows,indent=2))
if __name__=='__main__':main()
