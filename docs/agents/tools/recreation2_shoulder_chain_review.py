"""Exact telescoping decomposition of shoulder-head movement; no new solve."""
import argparse,json,math
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--summary',required=True);p.add_argument('--out',required=True);a=p.parse_args();d=json.loads(Path(a.summary).read_text());out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
if 'stages' not in next(iter(d['cases']['original']['pelvis_diagnostics'].values())):
    full = json.loads(Path(a.summary).with_name('report.json').read_text())
    for label, case in full['cases'].items():
        d['cases'][label]['pelvis_diagnostics'] = case['summary']['pelvis_diagnostics']
def sub(a,b):return [x-y for x,y in zip(a,b)]
def add(a,b):return [x+y for x,y in zip(a,b)]
def norm(a):return math.sqrt(sum(x*x for x in a))
def qangle(a,b):
 dot=abs(sum(x*y for x,y in zip(a,b)))/(norm(a)*norm(b));return math.degrees(2*math.acos(min(1,dot)))
result={'schema':'recreation2-shoulder-chain-decomposition.v1','limits':['Signed endpoint-vector decomposition, not independent causal attribution','Pixel contributions telescope through point projection; not world vectors projected at common depth','Source 2D joints are estimator outputs, not manual truth'],'comparisons':{}}
for label in ('pelvis_hip_torso','pelvis_frozen_spine','off_frozen_control'):
 rows=[]
 for sf,di in d['cases'][label]['pelvis_diagnostics'].items():
  base=d['cases']['original']['pelvis_diagnostics'][sf];actual=di['final_chain'];old=base['final_chain'];sides={}
  for side in ('l','r'):
   chain=['pelvis','spine_lower','spine_mid','spine_chest','clavicle_'+side,'upper_arm_'+side]
   assert all(actual[b]['parent']==a for a,b in zip(chain,chain[1:]))
   components=[]
   for index,name in enumerate(chain):
    parent=chain[index-1] if index else None
    row={'node':name,'parent':parent,'world_rotation_change_deg':qangle(actual[name]['world_rotation_wxyz'],old[name]['world_rotation_wxyz'])}
    for space,key in [('world','head_world'),('px','head_px')]:
     av=actual[name][key] if parent is None else sub(actual[name][key],actual[parent][key])
     bv=old[name][key] if parent is None else sub(old[name][key],old[parent][key])
     row['delta_'+space]=sub(av,bv)
     row['delta_'+space+'_norm']=norm(row['delta_'+space])
    components.append(row)
   for space,key in [('world','head_world'),('px','head_px')]:
    total=[sum(r['delta_'+space][i] for r in components) for i in range(len(components[0]['delta_'+space]))]
    expected=sub(actual[chain[-1]][key],old[chain[-1]][key]);assert norm(sub(total,expected))<1e-9
   sides[side]={'components':components,'total_shoulder_delta_world':sub(actual[chain[-1]]['head_world'],old[chain[-1]]['head_world']),'total_shoulder_delta_px':sub(actual[chain[-1]]['head_px'],old[chain[-1]]['head_px'])}
  stages={}
  for stage,snap in di['stages'].items():
   stages[stage]={s:sub(snap['upper_arm_'+s]['head_px'],base['stages'][stage]['upper_arm_'+s]['head_px']) for s in ('l','r')}
  rows.append({'source_frame':int(sf),'sides':sides,'stage_shoulder_delta_px':stages,'spine_targets':di['spine_targets']})
 result['comparisons'][label]=rows
(out/'chain-decomposition.json').write_text(json.dumps(result,indent=2)+'\n')
for label,rows in result['comparisons'].items():
 for r in rows:
  if r['source_frame'] not in (17,55):continue
  print(label,r['source_frame'])
  for side,v in r['sides'].items():print(side, 'total px',v['total_shoulder_delta_px'], 'components',[(x['node'],[round(c,3) for c in x['delta_px']]) for x in v['components']])
print('SHOULDER_CHAIN_REVIEW_PASS: all telescoping sums reconstruct final shoulder shifts')
