"""Verify unchanged channels, baseline and report torso bend/reachability costs."""
import argparse,json,math,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--directory',required=True);p.add_argument('--prior',required=True);p.add_argument('--probe',required=True);a=p.parse_args();out=Path(a.directory);r=json.loads((out/'report.json').read_text());prior=json.loads(Path(a.prior).read_text());assert r['probe_sha256']==hashlib.sha256(Path(a.probe).read_bytes()).hexdigest();assert r['sha256']['bundle']==hashlib.sha256(Path(a.prior).read_bytes()).hexdigest()
base=r['cases']['baseline'];b=json.loads((out/'baseline.bundle.json').read_text());assert b['frames']==prior['frames'];details={}
for label,c in r['cases'].items():
 s=c['summary'];assert len(c['source_observations'])==28 and len(c['output'])==48 and s['renderer_roundtrip_max_px']<.01
 candidate=json.loads((out/(label+'.bundle.json')).read_text());assert len(candidate['frames'])==29
 for old,new in zip(prior['frames'],candidate['frames'],strict=True):
  for key in ('frame','rootPosition','rootYaw','pelvisQuaternion'):assert old[key]==new[key]
  for bone,q in old['localQuaternions'].items():
   if bone not in ('spine_lower','spine_mid','spine_chest'):assert q==new['localQuaternions'][bone]
 key=[row for row in s['key_diagnostics'] if row['kind']=='source'];details[label]={'nonintersecting_source_frames':[row['source_frame'] for row in key if not row['ray_shell_intersects']],
  'baseline_bend_deg':{'min':min(row['baseline_chain_bend_deg'] for row in key),'max':max(row['baseline_chain_bend_deg'] for row in key)},
  'selected':[{k:v for k,v in row.items() if k not in ('chain_world_before','chain_world_after')} for row in key if row['source_frame'] in (1,17,23,29,41,55)]}
 if label!='baseline':
  for old,new in zip(base['output'],c['output'],strict=True):
   for joint,pt in old['pixels'].items():
    if joint.endswith(('hip','knee','ankle')):assert math.dist(pt,new['pixels'][joint])<.01
   for side in ('l','r'):assert math.dist(old['patch_world'][side],new['patch_world'][side])<1e-6
  details[label].update(bend_min_deg=min(row['chain_bend_deg'] for row in key),bend_max_deg=max(row['chain_bend_deg'] for row in key),
   max_chest_displacement_units=max(row['actual_chest_displacement_units'] for row in key),
   max_requested_ray_projection_residual_px=max(math.dist(row['after_shoulder_world_midpoint_projection_px'],row['source_target_px']) for row in key),
   max_chest_full_rotation_error_deg=max(row['chest_full_rotation_error_deg'] for row in key))
 print(label,json.dumps(details[label]))
(out/'reachability-bend-audit.json').write_text(json.dumps(details,indent=2)+'\n');print('TORSO_ENDPOINT_REVIEW_PASS: exact baseline/channels, fixed bones, lower body/sole unchanged, roundtrip passed')
