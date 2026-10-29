"""Define structured semantic interpolation without fabricating pixel/3D points."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-semantic-interpolation-v1';OUT.mkdir(exist_ok=True)
contract={'schema':'addams-semantic-interpolation-contract.v1','production_eligible':False,
 'per_frame_output':{
  'camera_shot_id':'required','body_orientation':'front|side|back|turning|unknown',
  'action_phase':'categorical','left_leg_state':'support|swing|airborne|occluded|unknown',
  'right_leg_state':'support|swing|airborne|occluded|unknown',
  'heel_state':'flat|raised|airborne|unknown','sole_evidence':'verified_visible|partial|unavailable',
  'evidence_level':'observed|model_inference|temporal_inference|human_confirmed',
  'confidence':0.0,'visible_facts':[],'uncertainties':[]},
 'grouping_rules':['same shot first','group adjacent frames with compatible categorical state','split on camera cut or semantic transition','at least 2–3 frames or one clear anchor plus neighboring context'],
 'group_targets':{'pose':['orientation','limb phase','joint visibility','left/right identity'],
  'contact':['support side','heel raised/flat','airborne candidate','sole evidence availability'],
  'camera':['shot id','crop/scale change','camera motion candidate'],
  'completion':['missing joint state','interpolation bracket','uncertainty propagation']},
 'semantic_completion_rules':[
  'Use preceding and following clear groups to infer a categorical state only when both agree or transition is explicit.',
  'Keep interpolated state evidence_level=temporal_inference.',
  'Do not create pixel coordinates, depth, focal length or sole-ground distance from semantic interpolation.',
  'If neighboring groups conflict, output unknown and queue human review.',
  'Contact labels remain candidates until supported by visible sole/ground evidence or a validated kinematic solution.'
 ],
 'current_example':{'group_id':'G5','frames':[62,63,64,65],
  'frame_semantics':{'62':'support_or_transition_candidate','63':'support_or_transition_candidate','64':'airborne_candidate','65':'airborne_candidate'},
  'semantic_transition':'63→64','clear_context':'user_confirmed','pixel_3d_completion':'blocked'},
 'next_step':'Run one structured semantic pass over representative frames, then expand labels to group interiors without per-frame coordinate inference.'}
(OUT/'contract.json').write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n');print(OUT/'contract.json')
