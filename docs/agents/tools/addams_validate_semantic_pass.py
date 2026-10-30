"""Validate semantic-only model output before interpolation."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
allowed={'body_orientation':{'front','side','back','turning','unknown'},'left_leg_state':{'support','swing','airborne','occluded','unknown'},'right_leg_state':{'support','swing','airborne','occluded','unknown'},'heel_state':{'flat','raised','airborne','unknown'},'sole_evidence':{'verified_visible','partial','unavailable','out_of_frame'}}
required={'group_id','shot_id','shot_change','action_phase','left_leg_state','right_leg_state','heel_state','sole_evidence','observed_facts','uncertainties','confidence'}
forbidden={'xy','xy_px','coordinates','depth','z','focal_length','intrinsics','metric_clearance','world_position'}
def validate(data):
 errors=[]
 if not isinstance(data,dict) or not isinstance(data.get('groups'),list):return ['top-level groups[] required']
 for i,g in enumerate(data['groups']):
  miss=required-set(g)
  if miss:errors.append(f'groups[{i}] missing {sorted(miss)}')
  for k,vals in allowed.items():
   if k in g and g[k] not in vals:errors.append(f'groups[{i}].{k} invalid {g[k]!r}')
  if 'confidence' in g and not isinstance(g['confidence'],(int,float)):
   errors.append(f'groups[{i}].confidence must number')
  if 'confidence' in g and not 0<=g['confidence']<=1:errors.append(f'groups[{i}].confidence outside 0..1')
  if isinstance(g,dict):
   found=forbidden & set(g)
   if found:errors.append(f'groups[{i}] forbidden geometric fields {sorted(found)}')
   if g.get('shot_change') not in {'none','candidate','confirmed','unknown'}:errors.append(f'groups[{i}].shot_change invalid')
 return errors
if len(sys.argv)>1:
 data=json.loads(Path(sys.argv[1]).read_text());errs=validate(data);print(json.dumps({'valid':not errs,'errors':errs},ensure_ascii=False));sys.exit(1 if errs else 0)
else:
 print('usage: addams_validate_semantic_pass.py response.json')
