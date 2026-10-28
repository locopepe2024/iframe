"""All known risk frames: full-body human annotation, immutable image provenance."""
import argparse,copy,gzip,hashlib,json,math,subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-full-joint-review-v1'
JOINTS={s+'_'+n:j for s,ids in [('left',[11,13,15,23,25,27]),('right',[12,14,16,24,26,28])] for n,j in zip(['shoulder','elbow','wrist','hip','knee','ankle'],ids)}
COCO={11:5,12:6,13:7,14:8,15:9,16:10,23:11,24:12,25:13,26:14,27:15,28:16}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def build():
 OUT.mkdir(exist_ok=True);images=OUT/'images';images.mkdir(exist_ok=True)
 queue=json.loads((BASE/'addams-segment-review-v1/review-queue.json').read_text());events=json.loads((BASE/'addams-segment-review-v1/event-reviewed.json').read_text());ev={f['source_frame']:f for f in events['frames']}
 prior=json.loads((BASE/'addams-contour-separated-v2/normalized.json').read_text());old={f['source_frame']:f for f in prior['frames']}
 obs=json.loads(gzip.decompress((BASE/'addams-segment-review-v1/observations.json.gz').read_bytes()))
 selected=sorted({f['source_frame'] for f in queue['frames'] if f['reasons']}|set(range(46,59)))
 source=json.loads((BASE/'addams-source-clip.json').read_text())['path'];assert digest(Path(source))==queue['source_sha256']
 expr='+'.join(f'eq(n\\,{sf-1})' for sf in selected)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',source,'-vf',f'select={expr}','-fps_mode','vfr',str(images/'native-%03d.png')],check=True)
 tasks=[]
 for i,sf in enumerate(selected):
  row=obs[sf-1];w,h=row['image_size'];event=ev.get(sf);points={};person=None;origin='none'
  if event and event['identity'].isdigit():person=row['independent_people'][int(event['identity'])];origin='user_selected_person_model_points'
  elif not event and len(row['independent_people'])==1:person=row['independent_people'][0];origin='single_detector_unverified_identity'
  for name,j in JOINTS.items():
   xy=None
   if person:xy=[person['coco17_xy'][COCO[j]][0]/w*960,person['coco17_xy'][COCO[j]][1]/h*520]
   points[name]={'xy_px':xy,'visibility':'uncertain','semantic':'joint','confirmed':False,'origin':origin}
   if sf in old and name in old[sf]['joints']:
    v=old[sf]['joints'][name];points[name]={**points[name],**copy.deepcopy(v),'semantic':v.get('semantic','joint'),'confirmed':True,'origin':'previous_human_review'}
  reasons=list(queue['frames'][sf-1]['reasons'])
  if 46<=sf<=58:reasons.append('kick_body_diagnostic')
  img=images/f'native-{i+1:03}.png'
  tasks.append({'source_frame':sf,'pts_s':row['pts_s'],'segment_id':row['segment_id'],'image':str(img.relative_to(OUT)),'image_sha256':digest(img),'native_size':[w,h],'reasons':reasons,'points':points,'identity':event['identity'] if event else 'uncertain','contact':event['contact'] if event else 'uncertain','event_previously_reviewed':bool(event),'candidates':[{'id':j,'box':[v/(w if k%2==0 else h) for k,v in enumerate(p['box_xyxy'])]} for j,p in enumerate(row['independent_people'])]})
 package={'schema':'addams-full-joint-tasks.v1','source_sha256':queue['source_sha256'],'coordinate_space':'review_image_pixels','image_size':[960,520],'joint_names':list(JOINTS),'inputs_sha256':{n:digest(BASE/n) for n in ['addams-segment-review-v1/event-reviewed.json','addams-segment-review-v1/review-queue.json','addams-contour-separated-v2/normalized.json']},'tasks':tasks}
 write(OUT/'tasks.json',package);package['tasks_sha256']=digest(OUT/'tasks.json')
 (OUT/'review.html').write_text(Path(__file__).with_suffix('.html').read_text().replace('/*PACKAGE*/{}',json.dumps(package,ensure_ascii=False)))
 print(json.dumps({'task_count':len(tasks),'native_images':len(selected),'prior_event_frames':sum(t['event_previously_reviewed'] for t in tasks),'out':str(OUT)},ensure_ascii=False))
def normalize(data,package,task_hash):
 if data.get('schema')!='addams-full-joint-review.v1' or data.get('tasks_sha256')!=task_hash or data.get('source_sha256')!=package['source_sha256']:raise ValueError('Wrong/stale annotation package')
 expected={t['source_frame']:t for t in package['tasks']};seen=set();frames=[]
 for r in data['frames']:
  sf=r['source_frame']
  if sf not in expected or sf in seen:raise ValueError('Unknown/duplicate source frame')
  seen.add(sf);t=expected[sf]
  if r['image_sha256']!=t['image_sha256']:raise ValueError('Wrong image')
  if r['identity'] not in ['uncertain','absent','visible_undetected']+[str(c['id']) for c in t['candidates']]:raise ValueError('Invalid identity')
  if r['contact'] not in ['uncertain','left','right','both','airborne','other']:raise ValueError('Invalid contact')
  if r['status'] not in ['reviewed','not_evaluable']:raise ValueError('Invalid status')
  if r['identity']=='absent' and (r['contact']!='uncertain' or r['status']!='not_evaluable'):raise ValueError('Absent target cannot provide pose/contact')
  if set(r['joints'])!=set(JOINTS):raise ValueError('Missing/unknown joints')
  for name,j in r['joints'].items():
   if j.get('confirmed') is not True or j['visibility'] not in ['visible','occluded','uncertain'] or j['semantic'] not in ['joint','body_contour']:raise ValueError('Explicit joint review required')
   xy=j.get('xy_px')
   if xy is not None and (len(xy)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=lim for v,lim in zip(xy,[960,520]))):raise ValueError('Invalid coordinates')
   if j['visibility']=='visible' and xy is None:raise ValueError('Visible point needs coordinates')
  frames.append({**r,'pts_s':t['pts_s'],'segment_id':t['segment_id']})
 return {'schema':'addams-full-joint-reviewed.v1','source_sha256':package['source_sha256'],'tasks_sha256':task_hash,'coordinate_space':'review_image_pixels','image_size':[960,520],'frames':sorted(frames,key=lambda f:f['source_frame']),'reviewed_count':len(frames),'pending_count':len(expected)-len(frames),'limits':['Only explicit confirmed skeletal points can constrain pose; contours are separate.','Human points do not determine unique depth or focal length.']}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['build','import']);p.add_argument('--export',type=Path);a=p.parse_args()
 if a.command=='build':build()
 else:
  if not a.export:p.error('--export required')
  package=json.loads((OUT/'tasks.json').read_text())
  for t in package['tasks']:
   if digest(OUT/t['image'])!=t['image_sha256']:raise ValueError('Changed source image')
  r=normalize(json.loads(a.export.read_text()),package,digest(OUT/'tasks.json'));r['export_sha256']=digest(a.export);write(OUT/'reviewed.json',r);print(r['reviewed_count'],r['pending_count'])
if __name__=='__main__':main()
