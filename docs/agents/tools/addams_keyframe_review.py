"""Key-pose review plan with partial human constraints, not dense manual labelling."""
import argparse,copy,json,re,hashlib
from pathlib import Path
from addams_full_joint_review import normalize as legacy_normalize,digest
B=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
O=B/'addams-keyframe-review-v1'
PLAN={1:'镜头开场',23:'已有人体标注姿势',37:'前段踢腿姿势',46:'踢腿方向变化前',49:'转向踢腿与体态异常',51:'前踢姿势',58:'转身与支撑变化',64:'离地事件',70:'第二镜头前段支撑',79:'腾空事件',88:'双脚支撑事件',98:'腾空且模型缺测',109:'右脚支撑且模型缺测',115:'腾空且模型缺测',125:'腾空且模型缺测',138:'身体触地前双脚姿势',145:'手/身体触地开始核对',154:'触地后腾空',158:'镜头结束支撑',159:'第三镜头开始/人物身份',164:'左脚支撑事件',170:'右脚支撑事件',174:'主角部分出画'}
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def build():
 O.mkdir(exist_ok=True)
 foot=B/'addams-foot-review-v2';pkg=json.loads((foot/'tasks.json').read_text());old=B/'addams-full-joint-review-v1'
 submitted=B/'addams-sparse-foot-review-v3/human-export.json'
 human=legacy_normalize(json.loads(submitted.read_text()),json.loads((old/'tasks.json').read_text()),digest(old/'tasks.json'))
 # All submitted frames remain independent constraints, including frames outside PLAN.
 write(O/'preserved-human-review.json',human)
 reviewed={f['source_frame']:f for f in human['frames']};tasks=[]
 for orig in pkg['tasks']:
  sf=orig['source_frame']
  if sf not in PLAN:continue
  t=copy.deepcopy(orig);t['selection_reason']=PLAN[sf]
  if sf in reviewed:
   f=reviewed[sf];t['points'].update(copy.deepcopy(f['joints']));t['identity']=f['identity'];t['contact']=f['contact'];t['body_previously_reviewed']=True
  for n,p in t['points'].items():
   if n.endswith(('_heel','_forefoot')):p['semantic']='foot_surface'
  tasks.append(t)
 assert len(tasks)==len(PLAN)==23
 events=json.loads((B/'addams-segment-review-v1/event-reviewed.json').read_text())
 write(O/'preserved-events.json',events)
 pkg.update(event_timeline=events['frames'],schema='addams-keyframe-tasks.v1',tasks=tasks,selection='Initial proposed poses, not validated extrema.',preserved_human_sha256=digest(O/'preserved-human-review.json'),preserved_events_sha256=digest(O/'preserved-events.json'))
 write(O/'tasks.json',pkg);pkg['tasks_sha256']=digest(O/'tasks.json')
 template=Path(__file__).with_suffix('.html').read_text();(O/'review.html').write_text(template.replace('/*PACKAGE*/{}',json.dumps(pkg,ensure_ascii=False)))
 print(json.dumps({'keyframes':len(tasks),'preserved_human_frames':len(human['frames']),'preserved_events':len(events['frames']),'already_reviewed_body_in_queue':[t['source_frame'] for t in tasks if t.get('body_previously_reviewed')]}))
def normalize(data,pkg,task_hash):
 if data.get('schema')!='addams-keyframe-review.v1' or data.get('tasks_sha256')!=task_hash or data.get('source_sha256')!=pkg['source_sha256']:raise ValueError('Wrong/stale package')
 expected={t['source_frame']:t for t in pkg['tasks']};seen=set();frames=[]
 for raw in data['frames']:
  r=copy.deepcopy(raw);sf=r['source_frame']
  if sf not in expected or sf in seen:raise ValueError('Unknown/duplicate frame')
  seen.add(sf);t=expected[sf]
  if r['image_sha256']!=t['image_sha256']:raise ValueError('Wrong image')
  if set(r['joints'])!=set(pkg['joint_names']):raise ValueError('Unexpected point names')
  for n,p in r['joints'].items():
   if p.get('confirmed') is not True:
    # Do not pass unchecked predictions or placeholders as human measurements.
    r['joints'][n]={'xy_px':None,'visibility':'uncertain','semantic':'foot_surface' if n.endswith(('_heel','_forefoot')) else 'joint','confirmed':False}
    continue
   import math
   if p['visibility'] not in ['visible','occluded','uncertain']:raise ValueError('Invalid visibility')
   if p['semantic'] not in ['joint','body_contour','foot_surface']:raise ValueError('Invalid semantics')
   xy=p.get('xy_px')
   if xy is not None and (len(xy)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=limit for v,limit in zip(xy,[960,520]))):raise ValueError('Invalid coordinate')
   if p['visibility']=='visible' and xy is None:raise ValueError('Visible point needs a position')
  if r['identity'] not in ['uncertain','absent','visible_undetected']+[str(c['id']) for c in t['candidates']]:raise ValueError('Invalid identity')
  if r['contact'] not in ['uncertain','left','right','both','airborne','other'] or r['status'] not in ['reviewed','not_evaluable']:raise ValueError('Invalid event/status')
  for k in ['left_support','right_support']:
   if r.get(k,'uncertain') not in ['uncertain','flat','forefoot','heel','none']:raise ValueError('Invalid support')
  if r['identity']=='absent' and (r['contact']!='uncertain' or r['status']!='not_evaluable'):raise ValueError('Absent target cannot constrain contact')
  frames.append({**r,'pts_s':t['pts_s'],'segment_id':t['segment_id']})
 return {'schema':'addams-keyframe-reviewed.v1','source_sha256':pkg['source_sha256'],'tasks_sha256':task_hash,'coordinate_space':'review_image_pixels','image_size':[960,520],'frames':frames,'reviewed_count':len(frames),'pending_count':len(expected)-len(frames),'preserved_human_sha256':pkg['preserved_human_sha256'],'preserved_events_sha256':pkg['preserved_events_sha256'],'limits':['Only confirmed visible skeletal points constrain joint projection.','Unchecked model predictions cleared; no automatic temporal propagation.']}
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['build','import']);p.add_argument('--export',type=Path);a=p.parse_args()
 if a.command=='build':build();return
 if not a.export:p.error('--export required')
 pkg=json.loads((O/'tasks.json').read_text())
 for t in pkg['tasks']:
  if digest(O/t['image'])!=t['image_sha256']:raise ValueError('Image changed')
 for file,key in [('preserved-human-review.json','preserved_human_sha256'),('preserved-events.json','preserved_events_sha256')]:
  if digest(O/file)!=pkg[key]:raise ValueError('Preserved evidence changed')
 result=normalize(json.loads(a.export.read_text()),pkg,digest(O/'tasks.json'));write(O/'reviewed.json',result);print(result['reviewed_count'],result['pending_count'])
if __name__=='__main__':main()
