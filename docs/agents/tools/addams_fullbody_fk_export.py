import bpy,json
from pathlib import Path
B=Path('/tmp/addams-pose');p=B/'continuous-ablation-smooth/candidate.blend';bpy.ops.wm.open_mainfile(filepath=str(p));a=next(o for o in bpy.data.objects if o.type=='ARMATURE');names=[b.name for b in a.data.bones]
# Blender collections are not guaranteed topologically ordered.
names.sort(key=lambda n:len(a.data.bones[n].parent_recursive))
rows=[]
for sf in range(48,60):
 bpy.context.scene.frame_set(sf);bpy.context.view_layer.update();rows.append({'source_frame':sf,'arm_world':[list(r) for r in a.matrix_world],'basis':{n:[list(r) for r in a.pose.bones[n].matrix_basis] for n in names},'pose':{n:[list(r) for r in a.pose.bones[n].matrix] for n in names}})
data={'names':names,'bones':{n:{'parent':a.data.bones[n].parent.name if a.data.bones[n].parent else None,'rest':[list(r) for r in a.data.bones[n].matrix_local],'inherit_scale':a.data.bones[n].inherit_scale} for n in names},'frames':rows,'scale':json.loads((B/'continuous-ablation-smooth/fit.json').read_text())['scale_review_px_per_unit']}
(B/'fullbody-fk.json').write_text(json.dumps(data)+'\n');print('FK_EXPORT',len(names))
