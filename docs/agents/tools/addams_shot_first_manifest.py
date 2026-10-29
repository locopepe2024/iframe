"""Create shot-first contract for motion groups; no automatic cut claim."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-shot-first-v1';OUT.mkdir(exist_ok=True)
motion=json.loads((ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1/manifest.json').read_text())
shot={'schema':'addams-shot-first-manifest.v1','source_range':[46,65],'fps':25,'production_eligible':False,
 'shots':[{'shot_id':'S_candidate_1','source_frames':list(range(46,66)),'status':'same_shot_candidate_pending_boundary_review',
  'camera_model_status':'one camera candidate only; focal/depth not separated','cut_before':None,'cut_after':None,
  'evidence':['no confirmed cut label within 46–65 in current evidence package'],
  'limits':['same-shot is a candidate, not proven','camera motion/zoom can still occur within shot','no cross-shot interpolation until boundary confirmed']}],
 'motion_groups':[{g['group_id']:{'shot_id':'S_candidate_1','source_frames':g['source_frames'],'representative_keyframes':g['representative_keyframes']}} for g in motion['groups']],
 'order':['shot_boundary','camera_candidate','motion_group','semantic_keyframes','temporal_fit','retarget_ik','validation'],
 'rules':['A motion group cannot cross a confirmed shot cut.','Camera candidate is solved/frozen per shot before pose fitting.','If shot status is pending, group output remains diagnostic only.','Do not use same-shot assumption to prove focal length or absolute depth.'],
 'next_step':'Review cut_before/cut_after at 46 and 65 plus within-range discontinuities, then freeze shot ID before group fitting.'}
(OUT/'manifest.json').write_text(json.dumps(shot,ensure_ascii=False,indent=2)+'\n');print(OUT/'manifest.json')
