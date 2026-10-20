"""Compact reports and endpoint controls for full chest orientation experiment."""
import argparse,json,hashlib,math,statistics
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--directory',required=True);a=p.parse_args();out=Path(a.directory);r=json.loads((out/'report.json').read_text());baseline=r['cases']['pelvis_frozen_spine'];rows={}
def sub(a,b):return [x-y for x,y in zip(a,b)]
for label,c in r['cases'].items():
 rows[label]=[]
 for ob in c['source_observations']:
  sf=ob['source_frame'];di=c['summary']['pelvis_diagnostics'][str(sf)];old=baseline['summary']['pelvis_diagnostics'][str(sf)];chain=di['final_chain'];base=old['final_chain'];offset={}
  for side in ('l','r'):
   clav='clavicle_'+side;shoulder='upper_arm_'+side
   offset[side]={'chest_head_delta_px':sub(chain['spine_chest']['head_px'],base['spine_chest']['head_px']),
                 'clavicle_head_delta_px':sub(chain[clav]['head_px'],base[clav]['head_px']),
                 'shoulder_head_delta_px':sub(chain[shoulder]['head_px'],base[shoulder]['head_px']),
                 'chest_to_clavicle_delta_px':sub(sub(chain[clav]['head_px'],chain['spine_chest']['head_px']),sub(base[clav]['head_px'],base['spine_chest']['head_px']))}
  rows[label].append({'source_frame':sf,'mean_px':ob['mean_px'],
                      'upper6_mean_px':statistics.mean(e for k,e in ob['per_joint_px'].items() if k.endswith(('shoulder','elbow','wrist'))),
                      'shoulder2_mean_px':statistics.mean(e for k,e in ob['per_joint_px'].items() if k.endswith('shoulder')),
                      'chest':di['chest'],'endpoint_changes_relative_to_pelvis_frozen':offset})
 for ob in c['source_observations']:
  if label in ('chest_off_full','chest_source_full'):
   old=next(v for v in baseline['source_observations'] if v['source_frame']==ob['source_frame'])
   assert all(ob['per_joint_px'][k]==old['per_joint_px'][k] for k in ob['per_joint_px'] if k.endswith(('hip','knee','ankle')))
 for di in c['summary']['pelvis_diagnostics'].values():assert di['chest']['head_change_units']<1e-6
 assert c['summary']['renderer_roundtrip_max_px']==0
(out/'chest-endpoint-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
compact={k:v for k,v in r.items() if k!='cases'};compact['cases']={}
for label,c in r['cases'].items():
 compact['cases'][label]={k:v for k,v in c['summary'].items() if k!='pelvis_diagnostics'}
 compact['cases'][label]['chest_max_head_change_units']=max(di['chest']['head_change_units'] for di in c['summary']['pelvis_diagnostics'].values())
(out/'summary.json').write_text(json.dumps(compact,indent=2)+'\n')
print('CHEST_REVIEW_PASS: lower-body unchanged, chest head unchanged, zero renderer roundtrip')
for label in ('pelvis_frozen_spine','chest_off_full','chest_source_full'):
 for row in rows[label]:
  if row['source_frame']==17:print(label, 'shoulder mean',row['shoulder2_mean_px'],'upper',row['upper6_mean_px'],'offsets',row['endpoint_changes_relative_to_pelvis_frozen'])
