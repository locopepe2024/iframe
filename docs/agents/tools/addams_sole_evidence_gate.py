"""Gate shoe observations by existence of visible sole geometry before IK."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary/contact-semantic-audit.json'
d=json.loads(source.read_text())
rows=[]
for r in d['rows']:
 # Existing observations are shoe upper/ankle-near; no explicit sole contour was marked.
 rows.append({**r,'sole_geometry_status':'unavailable','sole_geometry_evidence_level':'not_observed',
  'ik_eligible':False,'fallback_route':'temporal_skeleton_inference_or_human_review',
  'reason':'Blur/side/turning and current marker placement do not expose a verified heel, forefoot, toe, or sole-ground contour.'})
out={'schema':'addams-sole-evidence-gate.v1','production_eligible':False,
 'rule':'No visible sole geometry means no sole IK target. Shoe presence may remain as 2D evidence.',
 'states':{'verified_visible':'may map to heel/forefoot/toe after subtype review',
           'partial_contour':'2D shape/orientation only; no depth/contact lock',
           'unavailable':'temporal inference or human review; no IK'},
 'rows':rows,
 'limits':['This gate does not infer contact from proximity or darkness.','Current rows preserve the user shoe_proxy choice but are blocked from IK.','Neighboring frames are context, not substitute measurements.'],
 'next_step':'Classify each frame for sole evidence before any foot target is constructed.'}
p=ROOT/'docs/agents/raw/2026-10-30-addams-foot-proxy-boundary/sole-evidence-gate.json';p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(p)
