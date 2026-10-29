"""Create group-level motion semantics from adjacent-frame evidence; no pose rewrite."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1';OUT.mkdir(exist_ok=True)
manifest={'schema':'addams-motion-group-manifest.v1','source_range':[46,65],'fps':25,'production_eligible':False,
 'groups':[{
  'group_id':'G1','source_frames':[49,50,51,52,53,54,55],
  'boundary_status':'candidate_needs_transition_check','camera_shot':'assumed_same_shot_pending_cut_check',
  'action_semantics':{
   'left_leg':'lifted_and_forward_swing_candidate',
   'right_leg':'forefoot_support_candidate',
   'right_heel':'raised_or_tiptoe_candidate',
   'weight_relation':'right_support_left_swing_candidate'},
  'evidence_basis':['adjacent-frame visual similarity','existing left shoe observations 50/51/53','existing right shoe observations 49/51/52/55','user visual review'],
  'group_rules':{
   'inherit_side_roles':'soft_only','right_foot_ik':'blocked_until_sole_subtype_verified',
   'left_contact':'airborne_candidate_not_contact','interpolation':'within-group only; do not cross boundaries',
   'keyframes':'select entry/support/peak/exit instead of annotating every adjacent frame'},
  'confidence':'hypothesis_user_supported',
  'unresolved':['exact entry frame','exact exit frame','whether right forefoot actually touches ground in each frame','3D depth and camera scale']
 },{
  'group_id':'G0','source_frames':[46,47,48], 'boundary_status':'needs_review','action_semantics':{'phase':'entry_or_prior_transition'},
  'confidence':'unassessed','group_rules':{'do_not_inherit_G1_roles':True}},
 {'group_id':'G2','source_frames':[56,57,58,59,60,61,62,63,64,65], 'boundary_status':'needs_review','action_semantics':{'phase':'exit_or_run_flight_transition'},
  'confidence':'unassessed','group_rules':{'do_not_inherit_G1_roles':True}}],
 'global_rules':['Group semantics precede per-frame proxy mapping.','A clear frame can still lack sole subtype or contact proof.','Group inheritance is soft and must be checked at entry/exit and action peaks.','Only group-consistent keyframes enter pose fitting; adjacent duplicates are not independent evidence.'],
 'next_step':'Review G1 boundaries and annotate four semantic keyframes: entry, support, left-swing peak, exit.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(OUT/'manifest.json')
