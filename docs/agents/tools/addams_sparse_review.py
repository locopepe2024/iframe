"""Conservative review thinning; no inferred labels or interval propagation."""
import copy,hashlib,json,re,shutil
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
B=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
O=B/'addams-sparse-foot-review-v3';O.mkdir(exist_ok=True)
old=B/'addams-full-joint-review-v1';foot=B/'addams-foot-review-v2';human=Path('/Users/owen/Downloads/addams-full-joint-review.json')
from addams_full_joint_review import normalize,digest
base=json.loads((old/'tasks.json').read_text());export=json.loads(human.read_text());review=normalize(export,base,digest(old/'tasks.json'));write=lambda p,d:p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
shutil.copyfile(human,O/'human-export.json');write(O/'imported-reviewed.json',review);done={f['source_frame']:f for f in review['frames']}
pkg=json.loads((foot/'tasks.json').read_text());events=json.loads((B/'addams-segment-review-v1/event-reviewed.json').read_text());ev={f['source_frame']:f for f in events['frames']}
# Always retain shot edges, explicit contact changes and user-completed frames.
protected={1,64,65,66,158,159,174}|set(done)
for a,c in zip(events['frames'],events['frames'][1:]):
 if a['segment_id']==c['segment_id'] and a['contact']!=c['contact']:protected.update([a['source_frame'],c['source_frame']])
def image(t):
 im=Image.open(foot/t['image']).convert('L')
 # Fixed image-space thumbnail avoids independently normalizing character motion away.
 return im.resize((240,130),Image.Resampling.BILINEAR)
kept=[];groups=[];previous=None;cached={};decisions=[]
for task in pkg['tasks']:
 t=copy.deepcopy(task);sf=t['source_frame'];im=image(t);cached[sf]=im;keep=True;reason='first_or_boundary';mean=None
 if previous and previous['segment_id']==t['segment_id']:
  gap=sf-previous['source_frame'];diff=ImageChops.difference(im,cached[previous['source_frame']]);mean=ImageStat.Stat(diff).mean[0]
  hist=diff.histogram();total=sum(hist);count=0;p90=255
  for k,v in enumerate(hist):
   count+=v
   if count>=.9*total:p90=k;break
  keep=sf in protected or gap>=5 or mean>6 or p90>20
  reason='protected' if sf in protected else 'max_gap' if gap>=5 else 'image_change' if keep else 'similar_nearby'
 decisions.append({'source_frame':sf,'retained':keep,'reason':reason,'reference_frame':previous['source_frame'] if previous else None,'gray_mae_0_255':mean,'comparison':'fixed240x130 grayscale whole-image heuristic'})
 if keep:
  t['image']='../addams-full-joint-review-v1/images/'+Path(t['image']).name
  if sf in done:
   f=done[sf];t['points'].update(copy.deepcopy(f['joints']));t['identity']=f['identity'];t['contact']=f['contact'];t['body_previously_reviewed']=True
  kept.append(t);previous=t;groups.append({'representative_frame':sf,'deferred_frames':[]})
 else:groups[-1]['deferred_frames'].append(sf)
pkg['tasks']=kept;pkg['schema']='addams-sparse-foot-tasks.v3';pkg['legacy_tasks_sha256']=digest(old/'tasks.json');pkg['deduplication']={'max_interval_frames':5,'mean_gray_threshold':6,'p90_gray_threshold':20,'protected_frames':sorted(protected),'scope':'Review prioritization only; no copied human points or solved motion on deferred frames.'}
write(O/'tasks.json',pkg);pkg['tasks_sha256']=digest(O/'tasks.json');template=(foot/'review.html').read_text();template=re.sub(r'const pkg=.*?;\nconst \$=',lambda m:'const pkg='+json.dumps(pkg,ensure_ascii=False)+';\nconst $=',template,count=1,flags=re.S)
template=template.replace('<h1>关节与脚掌标注 v2</h1>','<h1>去重后的关节与脚掌标注</h1><p>已完成49–58帧的身体关节已带入，无需重复定位；这些帧保留用于可选脚掌补标。相似邻帧仅从本次人工队列暂缓，不传播人工点位，也不删除视频帧。脚部看不清可以标不确定。</p>')
(O/'review.html').write_text(template)
report={'original_tasks':99,'retained_tasks':len(kept),'deferred_tasks':99-len(kept),'imported_human_frames':sorted(done),'remaining_body_tasks':len(kept)-len(done),'groups':groups,'decisions':decisions,'limits':['Whole-image similarity can miss small limb/contact changes; this is conservative triage, not proof of identical pose.','Explicit event changes retained; unlabelled contact changes may still be missed.','No source frame deletion, pose interpolation or annotation propagation.','Foot annotations optional; unchanged hidden regions need no guessed location.']};write(O/'dedup-report.json',report);print(json.dumps({k:report[k] for k in ['original_tasks','retained_tasks','deferred_tasks','imported_human_frames','remaining_body_tasks']}))
