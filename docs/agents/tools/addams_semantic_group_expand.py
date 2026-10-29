"""Expand group-level semantic states to frames without inventing coordinates."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
base=ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1/manifest.json'
outdir=ROOT/'docs/agents/raw/2026-10-30-addams-semantic-interpolation-v1';outdir.mkdir(exist_ok=True)
manifest=json.loads(base.read_text())
frames=[]
for g in manifest['groups']:
 gid=g['group_id'];
 for sf in g['source_frames']:
  row={'source_frame':sf,'group_id':gid,'camera_shot_id':'S_candidate_1','evidence_level':'unassessed','confidence':0.0,
   'body_orientation':'unknown','action_phase':'unknown','left_leg_state':'unknown','right_leg_state':'unknown','heel_state':'unknown',
   'sole_evidence':'unavailable','coordinates_inferred':False,'depth_inferred':False,'notes':[]}
  if gid=='G5':
   row.update({'evidence_level':'human_confirmed','confidence':0.9 if sf in [64,65] else 0.75,
    'action_phase':'support_to_airborne_transition' if sf==63 else 'airborne' if sf in [64,65] else 'support_or_transition',
    'left_leg_state':'airborne_or_swing' if sf>=64 else 'support_or_transition',
    'right_leg_state':'airborne_or_swing' if sf>=64 else 'support_or_transition',
    'heel_state':'airborne' if sf>=64 else 'raised_or_unknown',
    'sole_evidence':'partial' if sf>=64 else 'unavailable',
    'notes':['User confirmed 64/65 sole leaves ground; right toe higher than left' if sf>=64 else 'G5 group context; no per-frame coordinate claim']})
  frames.append(row)
report={'schema':'addams-frame-semantic-expansion.v1','source_range':[46,65],'production_eligible':False,
 'frames':frames,'rules':['This output expands categorical semantics only.','No pixel/depth/focal/metric clearance values are created.',
 'human_confirmed may be used as a soft downstream prior; unassessed remains blocked.',
 'Group inheritance must be revised when LLM or human evidence conflicts.'],
 'coverage':{'human_confirmed_frames':[r['source_frame'] for r in frames if r['evidence_level']=='human_confirmed'],
 'unassessed_frames':[r['source_frame'] for r in frames if r['evidence_level']=='unassessed']}}
(outdir/'frame-semantics-seed.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(outdir/'frame-semantics-seed.json')
