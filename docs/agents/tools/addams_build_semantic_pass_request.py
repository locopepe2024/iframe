"""Build a bounded multimodal semantic-pass request for representative group frames."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
manifest=json.loads((ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1/manifest.json').read_text())
OUT=ROOT/'docs/agents/raw/2026-10-30-addams-semantic-interpolation-v1';OUT.mkdir(exist_ok=True)
frames=[]
for g in manifest['groups']:
 for sf in g['representative_keyframes']:
  frames.append({'group_id':g['group_id'],'source_frame':sf,'pts_s':(sf-1)/25,
   'image_path':f'docs/agents/raw/2026-10-29-addams-vlm-phase-test-v1/dense/frame-{sf:03}.jpg'})
prompt='''你是视频动作证据分析器。只分析提供的代表帧及其组关系，不生成像素坐标、三维深度、焦距或公制离地距离。\n\n任务：\n1. 判断每组是否属于同一镜头；发现切镜或明显相机变化时标记。\n2. 判断组内动作阶段及左右腿关系。\n3. 分别判断左脚、右脚是支撑候选、摆动候选、腾空候选或unknown。\n4. 判断脚跟flat/raised/airborne/unknown。\n5. 判断鞋底几何证据是verified_visible、partial、unavailable或out_of_frame。\n6. 明确区分observed事实、model_inference和unknown。\n\n输出严格JSON，不输出Markdown。每个group包含：group_id、shot_id、shot_change、action_phase、left_leg_state、right_leg_state、heel_state、sole_evidence、observed_facts、uncertainties、confidence。若前后帧无法确认，不要补全；写unknown。用户已确认：G5的64、65脚掌离地，右脚尖高于左脚尖，但仍需标记evidence_level=human_confirmed。'''
req={'schema':'addams-semantic-pass-request.v1','model_role':'multimodal_semantic_only','source_range':[46,65],'fps':25,
 'prompt':prompt,'frames':frames,'output_constraints':['JSON only','no coordinates','no depth/focal/metric clearance','preserve unknown','do not override human_confirmed facts'],
 'postprocess':'run addams_semantic_interpolator.py only after reviewing model output; never treat model output as ground truth'}
(OUT/'semantic-pass-request.json').write_text(json.dumps(req,ensure_ascii=False,indent=2)+'\n');print(OUT/'semantic-pass-request.json')
