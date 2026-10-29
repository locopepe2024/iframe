"""Render selected semantic soft tracks over source frames for visual review."""
import json
from pathlib import Path
from PIL import Image,ImageDraw
from addams_vlm_stream_probe import ROOT,FRAMES
FUS=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1.json').read_text())
OUT=ROOT/'docs/agents/raw/2026-10-29-addams-temporal-soft-fusion-v1';OUT.mkdir(exist_ok=True)
colors={'joint_center':(255,220,0),'shoe_proxy':(0,220,255)}
# Build a single point per semantic joint; retain separate left/right ankle semantics.
tracks=[]
for group,js in FUS['groups'].items():
 for joint,r in js.items():tracks.append((group,joint,r['track']))
frames=list(range(46,66));W,H=960,520
for sf in frames:
 im=Image.open(FRAMES/f'frame-{sf:03}.jpg').convert('RGB');d=ImageDraw.Draw(im)
 for group,joint,track in tracks:
  if sf not in track:continue
  x,y=track[sf]['xy'];col=colors[group];kind=track[sf]['kind'];rad=7 if kind=='observed' else 4
  d.ellipse((x-rad,y-rad,x+rad,y+rad),outline=col,width=3 if kind=='observed' else 2)
  d.text((x+8,y-8),f'{joint}:{"O" if kind=="observed" else "I"}',fill=col)
  # segment to previous frame, dotted interpolation is represented by thinner line
  if sf-1 in track:
   px,py=track[sf-1]['xy'];d.line((px,py,x,y),fill=col,width=2)
 d.rectangle((8,8,355,34),fill=(0,0,0));d.text((14,14),f'SOURCE {sf} / {(sf-1)/25:.2f}s | O=observed I=interpolated',fill='white')
 im.save(OUT/f'overlay-{sf:03}.png',quality=92)
# sheet
sheet=Image.new('RGB',(1920,5*284),(20,20,20));sd=ImageDraw.Draw(sheet)
for i,sf in enumerate(frames):
 im=Image.open(OUT/f'overlay-{sf:03}.png');im.thumbnail((480,260));x=i%4*480;y=i//4*284;sheet.paste(im,(x,y+24));sd.text((x+8,y+5),f'SOURCE {sf}',fill='white')
sheet.save(OUT/'overlay-sheet.jpg',quality=92)
(OUT/'review.html').write_text('''<!doctype html><meta charset="utf-8"><title>时序软轨迹叠图</title><style>body{background:#17191c;color:#eee;font:16px system-ui;margin:24px}img{max-width:100%}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}p{line-height:1.6}</style><h1>第46–65帧 · 语义分流时序软轨迹</h1><p>黄：joint_center姿态候选；青：shoe_proxy脚底候选。O为用户选择的本帧观测，I为前后锚点间线性插值。插值仅用于诊断，未写入Blender、未锁定接触。</p><img src="overlay-sheet.jpg"><div class="grid">'''+''.join(f'<figure><figcaption>源{sf}</figcaption><img src="overlay-{sf:03}.png"></figure>' for sf in frames)+'''</div></html>''')
print('WROTE',OUT/'review.html')
