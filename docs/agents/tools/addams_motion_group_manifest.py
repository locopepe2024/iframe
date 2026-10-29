"""Freeze user-provided adjacent-frame groups; semantics remain separate from boundaries."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1';OUT.mkdir(exist_ok=True)
windows=[(46,47),(48,49),(50,53),(54,57),(58,61),(62,65)]
sem={
 'G1':{'left_leg':'transition_or_lift_pending','right_leg':'support_or_transition_pending'},
 'G2':{'left_leg':'lifted_forward_swing_candidate','right_leg':'forefoot_support_candidate','right_heel':'raised_candidate'},
}
groups=[]
for i,(a,b) in enumerate(windows):
 gid=f'G{i}'
 groups.append({'group_id':gid,'source_frames':list(range(a,b+1)),'boundary_status':'user_defined_adjacent_window',
  'action_semantics':sem.get(gid,{'phase':'pending_group_semantics'}),'camera_shot':'same_shot_pending_cut_check',
  'representative_keyframes':[a,(a+b)//2,b] if b-a>=2 else [a,b],
  'group_rules':{'inherit_side_roles':'soft_only','interpolate_within_group_only':True,'cross_group_inheritance':False,
   'foot_ik':'blocked_until_visible_sole_evidence'},
  'confidence':'boundary_user_defined_semantics_partial' if gid=='G2' else 'boundary_user_defined_semantics_unassessed',
  'unresolved':['exact action phase','contact state per group','sole subtype','3D depth/camera scale']})
out={'schema':'addams-motion-group-manifest.v2','source_range':[46,65],'fps':25,'production_eligible':False,
 'user_windows':[[a,b] for a,b in windows],'groups':groups,
 'global_rules':['User-defined adjacent windows are the unit of semantic analysis.','Do not run independent frame-level pose/sole decisions for repeated frames.','Only representative keyframes are reviewed; group interpolation does not cross boundaries.','Clear visibility does not guarantee sole geometry or contact evidence.'],
 'next_step':'Review representative keyframes per window, then fit each group independently and compare boundary continuity.'}
(OUT/'manifest.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(OUT/'manifest.json')
