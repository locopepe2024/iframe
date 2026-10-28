import bpy,json
from pathlib import Path
BASE=Path('/tmp/addams-pose/continuous-shot1-v1')
bpy.ops.wm.open_mainfile(filepath=str(BASE/'candidate.blend'))
a=next(o for o in bpy.data.objects if o.type=='ARMATURE');rows=[]
for sf in range(1,66):
 bpy.context.scene.frame_set(sf);bpy.context.view_layer.update()
 pts={s+'_'+p:list(a.matrix_world@a.pose.bones[b+'_'+suffix].head) for s,suffix in [('left','l'),('right','r')] for p,b in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]}
 rows.append({'source_frame':sf,'xyz':pts})
(BASE/'geometry.json').write_text(json.dumps({'frames':rows,'scale_review_px_per_unit':json.loads((BASE/'report.json').read_text())['projection_scale_source_px_per_unit']/4},indent=2))
