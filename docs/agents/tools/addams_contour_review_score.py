"""Compare v1/v2 on identical skeletal labels; contours displayed separately."""
import json,math,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
BASE=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-contour-separated-v2'

def main():
    paths=[OUT/'normalized.json',BASE/'addams-human-reviewed-v1/candidates.json',OUT/'candidates.json',BASE/'addams-fixed-rig/distributed-score.json']
    review,old,new,baseline=[json.loads(p.read_text()) for p in paths]
    cases=[('original',{f['source_frame']:f['predicted'] for f in baseline['rows'] if f['case']=='distributed_swing'})]
    for prefix,data in [('v1',old),('v2',new)]:
        for c in data['candidates']:
            cases.append((prefix+'_'+str(c['temporal_weight']),{f['source_frame']:f['projected'] for f in c['frames']}))
    rows=[]
    for name,pred in cases:
        errors=[];frames=[]
        for frame in review['frames']:
            es={n:math.dist(pred[frame['source_frame']][n],j['xy_px']) for n,j in frame['joints'].items() if j['visibility']=='visible' and j.get('semantic','joint')=='joint'}
            errors+=list(es.values());frames.append({'source_frame':frame['source_frame'],'errors_px':es,'rmse_px':math.sqrt(sum(e*e for e in es.values())/len(es))})
        assert len(errors)==27
        rows.append({'case':name,'point_count':len(errors),'rmse_px':math.sqrt(sum(e*e for e in errors)/len(errors)),'frames':frames})
    report={'scope':'Same27 visible skeletal points for all cases; frame24 contour hips excluded',
            'input_sha256':{str(p.relative_to(BASE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},'rows':rows,
            'limits':['In-sample fitting residual, not independent3D validation.','Other frames retain legacyjoint semantics pending clarification.','Contours are not skeletal ground truth; physical contact not enforced.']}
    (OUT/'score.json').write_text(json.dumps(report,indent=2)+'\n')
    selected=['v1_0','v2_0','v2_1'];sheet=Image.new('RGB',(1440,5*290),'#202126')
    for ci,name in enumerate(selected):
        points=dict(cases)[name];scores=next(r for r in rows if r['case']==name)['frames']
        for fi,frame in enumerate(review['frames']):
            sf=frame['source_frame'];im=Image.open(BASE/f'addams-pose-review/frames/frame-{sf:03}.jpg').convert('RGB');draw=ImageDraw.Draw(im)
            for side,color in [('left','#2dd4bf'),('right','#fb923c')]:draw.line([tuple(points[sf][side+'_'+part]) for part in ['hip','knee','ankle']],fill=color,width=4)
            for n,j in frame['joints'].items():
                x,y=j['xy_px'];box=(x-6,y-6,x+6,y+6)
                if j.get('semantic')=='body_contour':draw.rectangle(box,outline='#f472b6',width=3)
                else:draw.ellipse(box,outline='white' if j['visibility']=='visible' else '#777777',width=2)
            sheet.paste(im.resize((480,260)),(ci*480,fi*290+30));ImageDraw.Draw(sheet).text((ci*480+4,fi*290+5),f'F{sf} {name} skeletal RMSE {scores[fi]["rmse_px"]:.2f}px',fill='white')
    sheet.save(OUT/'comparison.jpg')
    print([(r['case'],round(r['rmse_px'],2),round(r['frames'][-1]['rmse_px'],2)) for r in rows])

if __name__=='__main__':main()
