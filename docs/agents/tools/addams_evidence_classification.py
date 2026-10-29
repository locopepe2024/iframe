"""Classify frozen source evidence, without treating estimates as observations."""
import hashlib
import html
import json
from pathlib import Path
from addams_vlm_stream_probe import ROOT, FRAMES, save

B=ROOT/'docs/agents/raw/2026-10-29-addams-native-layered-v1'
O=ROOT/'docs/agents/raw/2026-10-29-addams-evidence-classification-v1'
O.mkdir(exist_ok=False)
review=json.loads((B/'human-score.json').read_text())
queue=json.loads((B/'semantic-review/queue.json').read_text())['items']
questioned={(r['source_frame'],r['joint']) for r in queue}
contact=json.loads((ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/addams-segment-review-v1/event-reviewed.json').read_text())
labels={r['source_frame']:r['contact'] for r in contact['frames']}
vlm=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-semantic-completion-v1/parsed.json').read_text())
vlm_states={r['source_frame']:r for r in vlm['frame_states']}
confirmation=json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-running-flight-v1/human-confirmation-064.json').read_text())
rows=[]
for sf in range(46,66):
 raw=(FRAMES/f'frame-{sf:03}.jpg').read_bytes()
 record=next((r for r in review['frames'] if r['source_frame']==sf),{'points':[]})
 for region in ['torso','left_leg','right_leg']:
  # No pixel-level clarity classifier has been validated. Leave exact visibility unassessed.
  points=[p for p in record['points'] if (region=='torso' and p['joint'].endswith(('hip','shoulder'))) or (region!='torso' and p['joint'].startswith(region.split('_')[0]+'_') and p['joint'].endswith(('knee','ankle')))]
  disputed=[p['joint'] for p in points if (sf,p['joint']) in questioned]
  rows.append({'source_frame':sf,'pts_s':(sf-1)/25,'region':region,
   'source_image_sha256':hashlib.sha256(raw).hexdigest(),
   'visibility_class':'unassessed','visibility_reason':'No validated per-region clarity/occlusion labels; clothing silhouette is not an anatomical joint observation.',
   'evidence_class':'semantic_conflict' if disputed else 'existing_annotation_unverified' if points else 'tool_estimate_only',
   'manual_points':[{k:p[k] for k in ['joint','review_xy','native_error_px','vitpose_error_px'] if k in p} for p in points],
   'semantic_review_needed':disputed,'decision':'do_not_lock_exact_joint',
   'allowed_action':'Review local visibility and point semantics before choosing anchors; then temporal completion of uncertain regions.',
   'hard_lock':False})
 for prop in ['contact','relative_toe_height']:
  if prop=='relative_toe_height' and sf!=64:continue
  state=vlm_states.get(sf,{})
  pred=None
  if state:
   l,r=state['left_contact'],state['right_contact']
   pred='unknown' if 'unknown' in [l,r] else 'both' if l==r=='contact' else 'left' if l=='contact' else 'right' if r=='contact' else 'airborne'
  confirmed=sf==64
  rows.append({'source_frame':sf,'pts_s':(sf-1)/25,'region':prop,
   'evidence_class':'human_confirmed' if confirmed else 'label_model_conflict' if sf in labels and pred is not None and labels[sf]!=pred else 'existing_annotation_unverified' if sf in labels else 'unknown',
   'existing_human_contact':labels.get(sf),'model_contact':pred,
   'confirmed_value':('airborne' if prop=='contact' else 'right_toe_higher_left_near_ground') if confirmed else None,
   'decision':'lock_semantic_fact_only' if confirmed else 'review_conflict' if sf in labels and pred is not None and labels[sf]!=pred else 'retain_provisional_do_not_propagate',
   'hard_lock':confirmed,'metric_height_known':False,
   'provenance':'human-confirmation-064.json' if confirmed else 'existing event-reviewed and frozen VLM candidates'})
spatial=[{'region':'camera','source_range':[49,65],'evidence_class':'background_supported_candidate','decision':'fixed_image_baseline_only','hard_lock':False,'unknown':['true_focal','absolute_depth','physical_camera_stationarity']},
 {'region':'camera','source_range':[46,48],'evidence_class':'not_covered_by_fixed_image_claim','decision':'needs_background_check','hard_lock':False},
 {'region':'ground','source_range':[46,65],'evidence_class':'diagnostic_convention','decision':'do_not_treat_as_source_measurement','hard_lock':False},
 {'region':'shot_boundary','between_frames':[65,66],'evidence_class':'agent_visual_observation','decision':'separate_shots_pending_boundary_audit','hard_lock':False}]
counts={}
for r in rows:counts[r['evidence_class']]=counts.get(r['evidence_class'],0)+1
result={'schema':'addams-evidence-classification.v1','source_range':[46,65],
 'rows':rows,'spatial':spatial,'counts':counts,'production_eligible':False,
 'limits':['This is evidence provenance classification, not measured pose recognition accuracy.',
           'Per-region visibility remains explicitly unassessed; no guessed clear/occluded labels.',
           'Existing manual coordinates may be contour/shoe proxies rather than joint centers.',
           'Model agreement and human-model agreement do not establish independent truth.',
           'Hard locks are semantic facts only; no new exact joint or camera locks.']}
save(O/'classification.json',result)
parts=['<!doctype html><html lang="zh"><meta charset="utf-8"><title>证据分类与判断</title><style>body{background:#17191c;color:#eee;font:16px/1.6 system-ui;margin:24px}article{border-top:1px solid #666;padding:18px 0}img{max-width:960px;width:100%}pre{white-space:pre-wrap}a{color:#9cf}</style><h1>第46–65帧：证据分类与判断</h1><p>先分类来源与冲突，尚未声称已完成局部清晰度/可见性分类。已有坐标不自动等于可靠锚点；人工确认的语义事实不等于精确3D。</p><p>64帧仅硬锁：双脚腾空、右脚尖更高、左脚尖近地。其他旧标签暂存，不向邻帧传播。无全量人工标注请求。</p>']
for sf in range(46,66):
 selected=[r for r in rows if r['source_frame']==sf]
 parts.append(f'<article><h2>源第{sf}帧 · {(sf-1)/25:.2f}s</h2><img loading="lazy" src="../2026-10-29-addams-vlm-phase-test-v1/dense/frame-{sf:03}.jpg"><pre>'+html.escape(json.dumps(selected,ensure_ascii=False,indent=2))+'</pre></article>')
parts.append('</html>');(O/'review.html').write_text('\n'.join(parts))
assert len([r for r in rows if r['region'] in ['torso','left_leg','right_leg']])==60
assert all(r['source_frame']==64 for r in rows if r['hard_lock'])
assert all(r['decision']=='do_not_lock_exact_joint' for r in rows if r['region'] in ['torso','left_leg','right_leg'])
print(json.dumps({'counts':counts,'hard_semantic_locks':sum(r['hard_lock'] for r in rows),'visibility_unassessed_regions':60},ensure_ascii=False))
