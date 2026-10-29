from pathlib import Path
import json
from PIL import Image,ImageDraw
from addams_vlm_stream_probe import ROOT,FRAMES
B=ROOT/'docs/agents/raw/2026-10-29-addams-native-layered-v1';O=ROOT/'docs/agents/raw/2026-10-29-addams-joint-semantics-v1';O.mkdir(exist_ok=True)
d=json.loads((B/'human-score.json').read_text())
rows=[]
for fr in d['frames']:
 sf=fr['source_frame']
 if not 49<=sf<=58: continue
 img=Image.open(FRAMES/f'frame-{sf:03}.jpg').convert('RGB')
 pts=[p for p in fr['points'] if p['joint'].endswith(('knee','ankle'))]
 for p in pts:
  x,y=map(int,p['review_xy']); x0,y0=max(0,x-140),max(0,y-140);x1,y1=min(img.width,x+140),min(img.height,y+140)
  crop=img.crop((x0,y0,x1,y1))
  draw=ImageDraw.Draw(crop)
  # local markers: human yellow, native magenta, vitpose cyan
  for key,col in [('review_xy',(255,220,0)),('native_xy',(255,0,255)),('vitpose_xy',(0,220,255))]:
   q=p.get(key)
   if q:
    xx,yy=int(q[0])-x0,int(q[1])-y0;draw.line((xx-9,yy,xx+9,yy),fill=col,width=3);draw.line((xx,yy-9,xx,yy+9),fill=col,width=3)
  path=O/f'{sf:03}-{p["joint"]}.png';crop.save(path)
  rows.append({'source_frame':sf,'joint':p['joint'],'crop':path.name,'manual_xy':p['review_xy'],'native_xy':p['native_xy'],'vitpose_xy':p['vitpose_xy'],'status':'needs_semantic_review','decision':'do_not_use_as_hard_joint_center','reason':'Crop requires human decision whether marker denotes anatomical joint center, clothing silhouette, or shoe proxy.'})
(O/'review.json').write_text(json.dumps({'schema':'addams-joint-semantics-review.v1','rows':rows,'production_eligible':False,'limits':['This is a crop review queue, not an automatic visibility classifier.','Pixel positions do not establish 3D depth or contact.']},ensure_ascii=False,indent=2)+'\n')
# contact sheet
W,H=560,360; sheet=Image.new('RGB',(W*4,H*((len(rows)+3)//4)),(25,25,25));draw=ImageDraw.Draw(sheet)
for i,r in enumerate(rows):
 im=Image.open(O/r['crop']).convert('RGB');im.thumbnail((W,310));x=i%4*W;y=i//4*H;sheet.paste(im,(x,y+45));draw.text((x+8,y+10),f'{r["source_frame"]} {r["joint"]} | Y=human M=native C=vit',fill='white')
sheet.save(O/'contact-sheet.jpg',quality=92)
html=['<!doctype html><meta charset="utf-8"><title>膝踝语义核对</title><style>body{background:#17191c;color:#eee;font:16px system-ui;margin:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{width:100%}article{border-top:1px solid #555;padding:12px 0}</style><h1>第49–58帧膝踝点语义核对</h1><p>黄Y=既有人工点，紫M=原生投影，青C=ViTPose候选。放大图只用于判断点位是否代表骨关节中心；尚未自动接受任何点。</p><div class="grid">']
for r in rows:html.append(f'<article><h3>源{r["source_frame"]} · {r["joint"]}</h3><img src="{r["crop"]}"><p>{r["decision"]}</p></article>')
html.append('</div>');(O/'review.html').write_text(''.join(html));print(json.dumps({'count':len(rows),'frames':sorted(set(r['source_frame'] for r in rows))}))
