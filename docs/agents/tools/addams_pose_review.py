"""Review saved predictions in one common 960x520 display coordinate system."""
import json,math,statistics,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-pose-review'
JOINTS=[(11,5),(12,6),(13,7),(14,8),(15,9),(16,10),(23,11),(24,12),(25,13),(26,14),(27,15),(28,16)]
EDGES=[(0,2),(2,4),(1,3),(3,5),(0,1),(0,6),(1,7),(6,7),(6,8),(8,10),(7,9),(9,11)]
def main():
 source=BASE/'addams-pose-media/observations.json'; rows=json.loads(source.read_text());metrics=[]
 events=[1,5,6,10,15,20,25,30,35,40,45,48,49,50]
 sheet=Image.new('RGB',(960,300*7),'#202020')
 for row in rows:
  f=row['source_frame'];im=Image.open(OUT/f'frames/frame-{f:03}.jpg').convert('RGB');d=ImageDraw.Draw(im)
  item={'source_frame':f,'pts_s':row['source_pts_s'],'status':'missing' if row['mediapipe'] is None else 'inferred_unreviewed'}
  if row['mediapipe'] is not None:
   m=[(row['mediapipe'][mi]['x']/4,row['mediapipe'][mi]['y']/4) for mi,_ in JOINTS]
   r=[(row['rtmpose']['coco17_xy'][ri][0]/4,row['rtmpose']['coco17_xy'][ri][1]/4) for _,ri in JOINTS]
   item.update(mean_model_disagreement_px=sum(math.dist(a,b) for a,b in zip(m,r))/12,min_mp_visibility=min(row['mediapipe'][mi]['visibility'] for mi,_ in JOINTS),min_rtm_score=min(row['rtmpose']['scores'][ri] for _,ri in JOINTS),mp_points_outside_image=sum(not(0<=x<960 and 0<=y<520) for x,y in m))
   for points,color in [(m,'#ff9933'),(r,'#33ff77')]:
    for a,b in EDGES:d.line([points[a],points[b]],fill=color,width=3)
    for x,y in points:d.ellipse((x-3,y-3,x+3,y+3),fill=color)
  d.rectangle((0,0,960,27),fill='black');d.text((8,7),f'Frame {f} | PTS {row["source_pts_s"]:.2f} | orange MP / green RTM | {item["status"]}',fill='white')
  im.save(OUT/f'frames/overlay-{f:03}.jpg')
  if f in events:
   i=events.index(f);sheet.paste(im.resize((480,260)),((i%2)*480,(i//2)*300))
  metrics.append(item)
 sheet.save(OUT/'contact-sheet.jpg')
 report={'units':'960x520 display pixels; original3840x2080 scaled independently by1/4','observations_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'frame_count':len(rows),'missing_frames':[r['source_frame'] for r in metrics if r['status']=='missing'],'model_disagreement_median_px':statistics.median(r['mean_model_disagreement_px'] for r in metrics if 'mean_model_disagreement_px' in r),'rows':metrics,'limits':['Two model agreement is not truth','RTM ROI depends on MP; missing MP skips RTM','No contact, camera or 3D validation']}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='rows'}))
if __name__=='__main__':main()
