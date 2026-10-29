"""Read-only sequence audit: separate limb identity from pose and contact errors."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw
from addams_vlm_stream_probe import ROOT, FRAMES, save

BASE = ROOT / 'docs/agents/raw/2026-10-29-addams-native-layered-v1'
OUT = ROOT / 'docs/agents/raw/2026-10-29-addams-temporal-identity-v1'
OUT.mkdir(exist_ok=False)
review = json.loads((BASE / 'human-score.json').read_text())
motion = json.loads((BASE / 'native-motion.json').read_text())['motion']['incam']['joints']
mapping = json.loads((BASE / 'frame-map.json').read_text())['frames']
K = review['camera_K']

def dist(a,b):
    return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))

def project(p):
    return [K[0][0]*p[0]/p[2]+K[0][2], K[1][1]*p[1]/p[2]+K[1][2]]

def angle(a,b,c):
    u=[x-y for x,y in zip(a,b)];v=[x-y for x,y in zip(c,b)]
    cosine=sum(x*y for x,y in zip(u,v))/(dist(a,b)*dist(c,b))
    return math.degrees(math.acos(max(-1,min(1,cosine))))

pairs=[]
for frame in review['frames']:
    points={r['joint']:r for r in frame['points']}
    for part in ['knee','ankle']:
        left,right='left_'+part,'right_'+part
        if left not in points or right not in points:
            continue
        l,r=points[left],points[right]
        same=dist(l['native_xy'],l['review_xy'])+dist(r['native_xy'],r['review_xy'])
        swapped=dist(l['native_xy'],r['review_xy'])+dist(r['native_xy'],l['review_xy'])
        pairs.append({'source_frame':frame['source_frame'],'joint_pair':part,
                      'same_identity_total_error_px':same,'swapped_total_error_px':swapped,
                      'swap_improves':swapped<same,
                      'interpretation':'assignment cost only; not proof of 3D anatomical identity'})
rows=[]
sheet=Image.new('RGB',(1920,5*284),(20,20,20));draw=ImageDraw.Draw(sheet)
for index,sf in enumerate(range(46,66)):
    m=min((r for r in mapping if r['source_frame']==sf),key=lambda r:abs(r['timing_error_s']))
    joints=motion[m['model_frame']]
    xy={name:project(joints[j]) for name,j in [('left_hip',1),('right_hip',2),('left_knee',4),('right_knee',5),('left_ankle',7),('right_ankle',8)]}
    rows.append({'source_frame':sf,'model_frame':m['model_frame'],'timing_error_s':m['timing_error_s'],
                 'projected':xy,'left_knee_internal_angle_deg':angle(joints[1],joints[4],joints[7]),
                 'right_knee_internal_angle_deg':angle(joints[2],joints[5],joints[8])})
    im=Image.open(FRAMES/f'frame-{sf:03}.jpg').convert('RGB')
    d=ImageDraw.Draw(im)
    for side,color in [('left',(255,90,80)),('right',(50,220,255))]:
        p=[tuple(xy[side+'_'+part]) for part in ['hip','knee','ankle']]
        d.line(p,fill=color,width=4)
        for x,y in p:d.ellipse((x-5,y-5,x+5,y+5),fill=color)
    im.thumbnail((480,260));x=index%4*480;y=index//4*284
    sheet.paste(im,(x,y+24));draw.text((x+8,y+5),f'SOURCE {sf} / L RED / R CYAN',fill='white')
sheet.save(OUT/'sequence-overlay.jpg',quality=93)
report={'schema':'addams-temporal-identity-audit.v1','source_range':[46,65],
        'paired_visible_label_checks':pairs,'sequence':rows,
        'swap_improves_pair_count':sum(p['swap_improves'] for p in pairs),
        'paired_checks_count':len(pairs),'production_writes':False,
        'limits':['Only paired visible manual knee/ankle labels can compare assignment.',
                  'Camera-space pose projection, original estimated K, no new camera fit.',
                  'Absence of a cheaper swap does not prove all-frame identity.',
                  'No floor height inferred from image ankle y; perspective and foot shape matter.',
                  'Do not infer airborne from knee angle alone.']}
save(OUT/'report.json',report)
(OUT/'review.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>连续肢体身份与姿态审计</title><style>body{background:#17191c;color:white;font:16px/1.6 system-ui;margin:24px}img{max-width:100%}a{color:#9cf}</style><h1>源46–65帧：连续肢体身份与姿态审计</h1><p>红：原恢复解剖左腿；青：右腿。轨迹来自既有3D相机空间投影，非人工标注，也非最终白模。检查前踢、收腿、转身、跑离是否连续。</p><img src="sequence-overlay.jpg"><p>有成对可见标签的帧才比较原左右与对调的像素代价；较低代价不证明真实3D。第64帧双脚腾空由用户复核，不按膝角或脚踝像素高度自动判断。</p><a href="report.json">数值报告</a></html>''')
print(json.dumps({'paired_checks':len(pairs),'swap_improves':report['swap_improves_pair_count'],'pairs':pairs},ensure_ascii=False))
