import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3];b=root/'docs/agents/raw/2026-10-28-motion-asset-package';old=b/'addams-full-joint-review-v1';out=b/'addams-foot-review-v2';out.mkdir(exist_ok=True)
d=json.loads((old/'tasks.json').read_text());oldhash=hashlib.sha256((old/'tasks.json').read_bytes()).hexdigest()
for t in d['tasks']:
 t['image']='../addams-full-joint-review-v1/'+t['image']
 for side in ['left','right']:
  for part in ['heel','forefoot']:
   name=side+'_'+part;t['points'][name]={'xy_px':None,'visibility':'uncertain','semantic':'joint','confirmed':False,'origin':'unannotated_foot_surface_point'}
d['joint_names'] += ['left_heel','left_forefoot','right_heel','right_forefoot'];d['schema']='addams-foot-tasks.v2';d['legacy_tasks_sha256']=oldhash;d['foot_point_contract']={'heel':'visible rear plantar surface of shoe/foot','forefoot':'visible front plantar surface near toe bases; not necessarily toe tip','note':'Surface proxy points, not skeletal joints. No ground contact inferred from point location alone.'}
p=out/'tasks.json';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');d['tasks_sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
s=(root/'docs/agents/tools/addams_full_joint_review.html').read_text();s=s.replace('ankle:\'踝\'','ankle:\'踝\',heel:\'脚跟底\',forefoot:\'前掌底\'')
s=s.replace('<h1>全片疑点关节标注</h1>','<h1>关节与脚掌标注 v2</h1><p>新增脚跟底、前掌底（脚趾根部附近鞋底，不是脚尖）。只标看得见的位置；脚掌点是表面代理，不是骨关节。左右脚接触方式分别选择，垫脚选前掌支撑。旧版已下载 JSON 可直接导入，已暂存的旧点自动带入。</p>')
options='<option value="uncertain">不确定</option><option value="flat">全掌着地</option><option value="forefoot">前掌支撑/垫脚</option><option value="heel">脚跟支撑</option><option value="none">离地</option>'
s=s.replace('<div id="joints"></div>', '<div><label>左脚掌接触<select id="left_support">'+options+'</select></label><label>右脚掌接触<select id="right_support">'+options+'</select></label></div><div id="joints"></div>')
s=s.replace("contact:t.contact,status:'reviewed'", "contact:t.contact,left_support:'uncertain',right_support:'uncertain',status:'reviewed'")
s=s.replace("'addams-full-joints:'+pkg.tasks_sha256", "'addams-foot-review:'+pkg.tasks_sha256")
pos="function progress()"
migrate="""try{if(!localStorage.getItem(key)){const old=JSON.parse(localStorage.getItem('addams-full-joints:'+pkg.legacy_tasks_sha256));if(Array.isArray(old)&&old.length===tasks.length){states=states.map((s,i)=>({...s,joints:{...s.joints,...old[i].joints},identity:old[i].identity,contact:old[i].contact,status:old[i].status,saved:false}));persist();}}}catch{}\n"""
s=s.replace(pos,migrate+pos)
s=s.replace("['identity','contact','status']", "['identity','contact','status','left_support','right_support']")
s=s.replace("contact:states[i].contact,status:states[i].status", "contact:states[i].contact,left_support:states[i].left_support,right_support:states[i].right_support,status:states[i].status")
s=s.replace("schema:'addams-full-joint-review.v1'", "schema:'addams-foot-review.v2'")
s=s.replace("a.download='addams-full-joint-review.json'", "a.download='addams-foot-review.json'")
s=s.replace("if(d.schema!=='addams-full-joint-review.v1'||d.tasks_sha256!==pkg.tasks_sha256||d.source_sha256!==pkg.source_sha256)","const legacy=d.schema==='addams-full-joint-review.v1'&&d.tasks_sha256===pkg.legacy_tasks_sha256;if((!legacy&&(d.schema!=='addams-foot-review.v2'||d.tasks_sha256!==pkg.tasks_sha256))||d.source_sha256!==pkg.source_sha256)")
s=s.replace("const s={joints:f.joints,identity:f.identity,contact:f.contact,status:f.status,saved:true};if(!validState(s,i)||error(s))", "const s={joints:legacy?{...structuredClone(tasks[i].points),...f.joints}:f.joints,identity:f.identity,contact:f.contact,left_support:f.left_support||'uncertain',right_support:f.right_support||'uncertain',status:f.status,saved:!legacy};if(!validState(s,i)||(!legacy&&error(s)))")
s=s.replace('/*PACKAGE*/{}',json.dumps(d,ensure_ascii=False));(out/'review.html').write_text(s)
print(out/'review.html')
