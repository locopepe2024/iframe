"""Existing selected shoe points with adjacent unmarked source context."""
import json
from PIL import Image,ImageDraw
from addams_vlm_stream_probe import ROOT,FRAMES
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary'
f=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json').read_text())
rows=[]
for joint,data in f['groups']['shoe_proxy'].items():
 for sf,xy in data['observations'].items():rows.append((int(sf),joint,xy))
rows.sort();sheet=Image.new('RGB',(1200,len(rows)*260),(22,22,25));d=ImageDraw.Draw(sheet)
for i,(sf,j,xy) in enumerate(rows):
 for col,frame in enumerate([sf-1,sf,sf+1]):
  im=Image.open(FRAMES/f'frame-{frame:03}.jpg').convert('RGB')
  x,y=xy; box=(int(x)-100,int(y)-85,int(x)+100,int(y)+85)
  crop=im.crop(box)
  if frame==sf:
   q=ImageDraw.Draw(crop);xx=x-box[0];yy=y-box[1];q.ellipse((xx-5,yy-5,xx+5,yy+5),outline=(255,220,0),width=2)
  crop=crop.resize((400,220));sheet.paste(crop,(400*col,i*260+35))
  d.text((400*col+6,i*260+8),f'{j} selected{sf} | SOURCE {frame}',fill='white')
sheet.save(OUT/'shoe-context.jpg',quality=95)
print(OUT/'shoe-context.jpg')
