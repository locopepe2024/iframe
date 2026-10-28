"""Five-frame review interchange; predictions never count as submitted labels."""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path

BASE=Path(os.environ['ADDAMS_TEST_BASE']) if 'ADDAMS_TEST_BASE' in os.environ else Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
JOINTS={'left_hip':23,'right_hip':24,'left_knee':25,'right_knee':26,'left_ankle':27,'right_ankle':28}
CONTACT=['left','right','both','airborne','uncertain']


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,data): path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')


def build(out):
    out.mkdir(parents=True,exist_ok=True);(out/'images').mkdir(exist_ok=True)
    obs={r['source_frame']:r for r in json.loads((BASE/'addams-pose-media/observations.json').read_text())}
    tasks=[]
    for sf in range(20,25):
        src=BASE/f'addams-pose-review/frames/frame-{sf:03}.jpg';dest=out/'images'/src.name
        dest.write_bytes(src.read_bytes());o=obs[sf];regions=[]
        for name,j in JOINTS.items():
            p=o['mediapipe'][j]
            regions.append({'id':name,'from_name':'joints','to_name':'image','type':'keypointlabels',
                            'original_width':960,'original_height':520,'image_rotation':0,
                            'value':{'x':p['x']/o['image_size_wh'][0]*100,'y':p['y']/o['image_size_wh'][1]*100,'width':.6,'keypointlabels':[name]}})
        tasks.append({'data':{'image':f'/data/local-files/?d=images/{src.name}','clip_id':'addams-first2s',
                              'source_frame':sf,'source_pts_s':o['source_pts_s'],'image_sha256':digest(dest),
                              'image_width':960,'image_height':520},
                      'predictions':[{'model_version':'mediapipe-unreviewed','result':regions}]})
    write(out/'tasks.json',tasks)
    config='<View><Header value="Frame $source_frame | PTS $source_pts_s"/><Image name="image" value="$image" zoom="true"/><KeyPointLabels name="joints" toName="image">'+''.join(f'<Label value="{n}"/>' for n in JOINTS)+'</KeyPointLabels><Choices name="visibility" toName="image" perRegion="true" required="true" choice="single-radio"><Choice value="visible"/><Choice value="occluded"/><Choice value="uncertain"/></Choices><Choices name="frame_status" toName="image" required="true" choice="single-radio"><Choice value="reviewed"/><Choice value="not_evaluable"/></Choices><Choices name="contact" toName="image" required="true" choice="single-radio">'+''.join(f'<Choice value="{c}"/>' for c in CONTACT)+'</Choices></View>'
    (out/'label-config.xml').write_text(config)
    embedded=[]
    for t in tasks:
        e=json.loads(json.dumps(t));e['preview']='data:image/jpeg;base64,'+base64.b64encode((out/'images'/f"frame-{t['data']['source_frame']:03}.jpg").read_bytes()).decode();embedded.append(e)
    template=(Path(__file__).with_name('addams_annotation_reviewer.html')).read_text()
    (out/'review.html').write_text(template.replace('/*TASK_DATA*/[]',json.dumps(embedded)))
    write(out/'normalized.json',normalize(tasks,tasks,out))
    print(out)


def normalize(exports,seeds,package):
    expected={t['data']['source_frame']:t['data'] for t in seeds};seen=set();frames=[]
    for task in exports:
        data=task['data'];sf=data['source_frame']
        if sf not in expected or sf in seen: raise ValueError('Unknown or duplicate frame')
        seen.add(sf);canonical=expected[sf]
        for key in ['clip_id','source_pts_s','image_sha256','image_width','image_height']:
            if data.get(key)!=canonical[key]: raise ValueError('Stale or mismatched '+key)
        if digest(package/'images'/f'frame-{sf:03}.jpg')!=canonical['image_sha256']: raise ValueError('Image hash mismatch')
        annotations=[a for a in task.get('annotations',[]) if not a.get('was_cancelled',False)]
        if len(annotations)>1: raise ValueError('Resolve multiple annotations before importing')
        item={'source_frame':sf,'pts_s':canonical['source_pts_s'],'image_sha256':canonical['image_sha256'],
              'status':'pending','joints':{},'contact':'uncertain'}
        if annotations:
            results=annotations[0]['result'];points={};visibility={};status=[];contact=[]
            for r in results:
                field=r.get('from_name');v=r.get('value',{})
                if field=='joints':
                    labels=v.get('keypointlabels',[])
                    if len(labels)!=1 or labels[0] not in JOINTS: raise ValueError('Unknown joint label')
                    name=labels[0]
                    if name in points or r['id'] in [q[0] for q in points.values()]: raise ValueError('Duplicate joint/region')
                    if r.get('original_width')!=960 or r.get('original_height')!=520 or r.get('image_rotation',0)!=0: raise ValueError('Unsupported image dimensions/rotation')
                    xy=[v['x'],v['y']]
                    if not all(isinstance(x,(int,float)) and math.isfinite(x) and 0<=x<=100 for x in xy): raise ValueError('Invalid keypoint coordinate')
                    points[name]=(r['id'],[xy[0]*9.6,xy[1]*5.2])
                elif field=='visibility':
                    choices=v.get('choices',[])
                    if r['id'] in visibility or len(choices)!=1 or choices[0] not in ['visible','occluded','uncertain']: raise ValueError('Invalid visibility')
                    visibility[r['id']]=choices[0]
                elif field=='frame_status':status+=v.get('choices',[])
                elif field=='contact':contact+=v.get('choices',[])
            if status not in [['reviewed'],['not_evaluable']] or len(contact)!=1 or contact[0] not in CONTACT: raise ValueError('Explicit frame/contact review required')
            if status==['reviewed'] and set(points)!=set(JOINTS): raise ValueError('Review all six joints; mark hidden joints uncertain/occluded')
            for name,(rid,xy) in points.items():
                if rid not in visibility: raise ValueError('Explicit joint visibility required')
                item['joints'][name]={'xy_px':xy,'visibility':visibility[rid]}
            item.update(status=status[0],contact=contact[0])
        frames.append(item)
    for sf in set(expected)-seen:
        c=expected[sf];frames.append({'source_frame':sf,'pts_s':c['source_pts_s'],'image_sha256':c['image_sha256'],'status':'pending','joints':{},'contact':'uncertain'})
    frames.sort(key=lambda r:r['source_frame'])
    return {'schema':'addams-reviewed-points.v1','coordinate_space':'review_image_pixels','image_size':[960,520],
            'source':'submitted_annotations_only','frames':frames,
            'solver_ready':all(r['status']=='reviewed' and sum(j['visibility']=='visible' for j in r['joints'].values())>=4 for r in frames)}


def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['build','import']);p.add_argument('--package',type=Path,required=True);p.add_argument('--export',type=Path);a=p.parse_args()
    if a.command=='build':build(a.package)
    else:
        if not a.export:p.error('--export required')
        result=normalize(json.loads(a.export.read_text()),json.loads((a.package/'tasks.json').read_text()),a.package)
        result['export_sha256']=digest(a.export);result['tasks_sha256']=digest(a.package/'tasks.json')
        write(a.package/'normalized.json',result);print('solver_ready:',result['solver_ready'])

if __name__=='__main__':main()
