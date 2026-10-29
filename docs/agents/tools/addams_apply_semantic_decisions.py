"""Freeze user semantic/source choices into evidence layer; no motion or IK writes."""
import json,statistics
from pathlib import Path
from addams_vlm_stream_probe import ROOT,save
D=json.loads(Path('/Users/owen/Downloads/joint-semantics-decisions.json').read_text())
assert D['schema']=='addams-joint-semantics-annotation.v2'
B=ROOT/'docs/agents/raw/2026-10-29-addams-native-layered-v1';O=ROOT/'docs/agents/raw/2026-10-29-addams-joint-semantics-v1'
h=json.loads((B/'human-score.json').read_text());lookup={(f['source_frame'],p['joint']):p for f in h['frames'] for p in f['points']}
rows=[]
for key,decision in D['decisions'].items():
 sf,j=key.split('-',1);p=lookup.get((int(sf),j));
 row={'source_frame':int(sf),'joint':j,**decision,'provenance':'user_download_2026-10-29','production_hard_lock':False}
 if p:
  row.update({'native_error_against_existing_review_px':p['native_error_px'],'vitpose_error_against_existing_review_px':p['vitpose_error_px']})
  if decision['coordinate']=='vitpose_c':row['selected_candidate_error_px']=p['vitpose_error_px']
  elif decision['coordinate']=='native_m':row['selected_candidate_error_px']=p['native_error_px']
  else:row['selected_candidate_error_px']=None
 rows.append(row)
selected_joints=[r for r in rows if r['semantic']=='joint_center']
vit=[r for r in selected_joints if r['coordinate']=='vitpose_c']
all_joint=[r for r in selected_joints if r.get('native_error_against_existing_review_px') is not None]
summary={'total':len(rows),'semantic_counts':{},'coordinate_counts':{},'joint_center_count':len(selected_joints),'joint_center_vitpose_count':len(vit),'joint_center_native_count':sum(r['coordinate']=='native_m' for r in selected_joints),'joint_center_human_count':sum(r['coordinate']=='human_y' for r in selected_joints),'joint_error_comparison':{'n':len(all_joint),'native_median_px':statistics.median(r['native_error_against_existing_review_px'] for r in all_joint),'native_mean_px':statistics.mean(r['native_error_against_existing_review_px'] for r in all_joint),'vitpose_median_px':statistics.median(r['vitpose_error_against_existing_review_px'] for r in all_joint),'vitpose_mean_px':statistics.mean(r['vitpose_error_against_existing_review_px'] for r in all_joint)},'limits':['Existing review points are not independent ground truth.','Selected human_y coordinates have no model error metric.','Shoe proxy selections are not scored as joint-center accuracy.','No production action, camera or IK changes.']}
for r in rows:
 summary['semantic_counts'][r['semantic']]=summary['semantic_counts'].get(r['semantic'],0)+1;summary['coordinate_counts'][r['coordinate']]=summary['coordinate_counts'].get(r['coordinate'],0)+1
save(O/'applied-decisions.json',{'schema':'addams-joint-semantics-applied.v1','input_sha256':__import__('hashlib').sha256(Path('/Users/owen/Downloads/joint-semantics-decisions.json').read_bytes()).hexdigest(),'rows':rows,'summary':summary,'production_eligible':False})
print(json.dumps(summary,ensure_ascii=False))
