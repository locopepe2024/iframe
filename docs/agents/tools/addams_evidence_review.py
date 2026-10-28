"""Pair annotation with actual rig projection and explicitly labelled input evidence."""
import json,gzip,hashlib,shutil,re
from pathlib import Path
B=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
O=B/'addams-evidence-review-v1';O.mkdir(exist_ok=True)
projection=json.loads(Path('/private/tmp/addams-review-projections.json').read_text());assert len(projection['frames'])==65
shutil.copyfile('/private/tmp/addams-review-projections.json',O/'rig-projections.json')
parent=B/'addams-keyframe-review-v1';pkg=json.loads((parent/'tasks.json').read_text());proj={f['source_frame']:f['projected'] for f in projection['frames']};obs=json.loads(gzip.decompress((B/'addams-segment-review-v1/observations.json.gz').read_bytes()))
ids={'left_shoulder':11,'right_shoulder':12,'left_elbow':13,'right_elbow':14,'left_wrist':15,'right_wrist':16,'left_hip':23,'right_hip':24,'left_knee':25,'right_knee':26,'left_ankle':27,'right_ankle':28}
for t in pkg['tasks']:
 sf=t['source_frame'];t['rig_projection']=proj.get(sf);people=obs[sf-1]['mp_people'];t['mp_input']=None
 if len(people)==1:t['mp_input']={n:[people[0]['landmarks'][j]['x']/4,people[0]['landmarks'][j]['y']/4] for n,j in ids.items()}
 t['review_prompt']='尚无对应三维候选。此处仅显示输入估计，不要求凭模型分歧猜错点。'
 if sf<=65:t['review_prompt']='核对紫色白模投影与源人物的可见关节；绿色为输入建议，橙色虚线为原MP输入，均非人工真值。'
 if sf==49:t['review_prompt']='已确认体态异常：核对源人物可见的肩、髋与抬腿。已有人工点保留，无需重复定位；遮挡点留空。'
 if sf in [51,58]:t['review_prompt']='异常区间的前后参考姿势。只核对可见肩/髋和腿；这帧的原人工标注已保留。'
pkg['projection_provenance']={k:projection[k] for k in ['blend_sha256','blend_path','camera','fps','limits']}
# Keep annotation task version unchanged: evidence presentation does not change label coordinates or export contract.
pkg['tasks_sha256']=hashlib.sha256((parent/'tasks.json').read_bytes()).hexdigest()
(O/'evidence.json').write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
s=(parent/'review.html').read_text();s=re.sub(r'const pkg=.*?;\nconst \$=',lambda m:'const pkg='+json.dumps(pkg,ensure_ascii=False)+';\nconst $=',s,count=1,flags=re.S)
s=s.replace('<h1>关键姿势标注</h1>','<h1>源片与白模证据复核</h1><p id="reviewPrompt" role="status"></p><div><label><input id="showRig" type="checkbox" checked>紫色：实际白模骨架投影</label><label><input id="showMP" type="checkbox">橙色虚线：MP输入估计</label></div><details><summary>同步查看源片与对应白模版本</summary><video controls preload="metadata" width="960" src="../addams-continuity-ablation-v1/comparison.mp4"></video><p>仅第一镜头1–65帧有该版本白模；下方时间轴源PTS供定位，视频不代表通过验收。</p></details>')
helper="""const evidenceEdges=[['left_shoulder','right_shoulder'],['left_hip','right_hip'],...['left','right'].flatMap(s=>[[s+'_shoulder',s+'_hip'],[s+'_shoulder',s+'_elbow'],[s+'_elbow',s+'_wrist'],[s+'_hip',s+'_knee'],[s+'_knee',s+'_ankle']])];
function evidence(points,color,dashed=false){if(!points)return;ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=3;if(dashed)ctx.setLineDash([7,5]);for(const [a,b] of evidenceEdges){if(!points[a]||!points[b])continue;ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}for(const [name,p] of Object.entries(points)){ctx.beginPath();ctx.arc(...p,4,0,Math.PI*2);ctx.stroke();}ctx.restore();}
"""
s=s.replace('function draw(){',helper+'function draw(){',1)
s=s.replace('for(const c of tasks[index].candidates)',"if($('showRig').checked)evidence(tasks[index].rig_projection,'#e879f9');if($('showMP').checked)evidence(tasks[index].mp_input,'#fbbf24',true);for(const c of tasks[index].candidates)",1)
s=s.replace("const t=tasks[index],s=states[index];$('jump')", "const t=tasks[index],s=states[index];$('reviewPrompt').textContent=t.review_prompt;$('jump')")
s=s.replace('load();\n</script>',"$('showRig').onchange=draw;$('showMP').onchange=draw;\nload();\n</script>")
(O/'review.html').write_text(s)
print('Evidence page built; actual rig projections for',sum(t['rig_projection'] is not None for t in pkg['tasks']),'of',len(pkg['tasks']),'tasks')
