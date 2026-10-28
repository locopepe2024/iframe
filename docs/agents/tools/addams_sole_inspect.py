"""Inspect foot-weighted mesh vertices in rest pose; no floor assumptions."""
import json
from pathlib import Path
import bpy
from mathutils import Vector
BASE=Path('/tmp/addams-annotation-check');OUT=BASE/'sole-review-v1';OUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'blender-roundtrip-v2/reviewed-leg-candidates.blend'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');arm.animation_data.action=None
arm.location=(0,0,0)
for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
rows=[]
for obj in bpy.data.objects:
 if obj.type!='MESH':continue
 groups={g.index:g.name for g in obj.vertex_groups}
 foot={i:n for i,n in groups.items() if n in ['ankle_r','foot_r','DEF_foot_r','toe_r','toe_attachment_r']}
 if not foot:continue
 verts=[]
 for v in obj.data.vertices:
  w=sum(g.weight for g in v.groups if g.group in foot)
  if w>=.5:
   p=obj.matrix_world@v.co;verts.append({'index':v.index,'weight':w,'rest_world':list(p)})
 if verts:rows.append({'object':obj.name,'foot_groups':list(foot.values()),'vertex_count':len(obj.data.vertices),'foot_vertex_count':len(verts),'foot_vertices':verts})
(OUT/'mesh-inspection.json').write_text(json.dumps({'meshes':rows},indent=2)+'\n')
print([(r['object'],r['foot_vertex_count'],r['foot_groups']) for r in rows])
