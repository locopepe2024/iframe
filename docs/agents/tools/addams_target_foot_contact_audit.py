"""Derive target-rig foot sole proxies from the skinned mesh, independent of source pixels."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector
O=Path('/tmp/addams-pose/gvhmr-native-v1');bpy.ops.wm.open_mainfile(filepath=str(O/'rotation-candidate.blend'));scene=bpy.context.scene;arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=next(o for o in bpy.data.objects if o.type=='MESH' and len(o.data.vertices)>5000)
deps=bpy.context.evaluated_depsgraph_get();rows=[]
def P(n):return arm.matrix_world@arm.pose.bones[n].head
def T(n):return arm.matrix_world@arm.pose.bones[n].tail
for sf in [49,52,53]:
 i=min(range(35),key=lambda x:abs((37+round(x*25/30))-sf));scene.frame_set(i+1);bpy.context.view_layer.update();evalmesh=mesh.evaluated_get(deps);verts=[mesh.matrix_world@v.co for v in evalmesh.data.vertices]
 frame={'source_frame':sf,'model_frame':i,'feet':{}}
 for s in ['l','r']:
  ankle=P('ankle_'+s);foot=T('foot_'+s);toe=T('toe_'+s);axis=(toe-ankle).normalized(); cluster=[]
  for v in verts:
   rel=v-ankle; along=rel.dot(axis); lateral=(rel-axis*along).length
   if -0.18<=along<=0.34 and lateral<0.22:cluster.append(v)
  if not cluster:continue
  floor=min(v.z for v in cluster); sole=[v for v in cluster if v.z<=floor+0.025]; heel=min(sole,key=lambda v:(v-ankle).dot(axis)); fore=max(sole,key=lambda v:(v-ankle).dot(axis));
  frame['feet'][s]={'cluster_count':len(cluster),'floor_z':floor,'heel_world':list(heel),'forefoot_world':list(fore),'toe_bone_world':list(toe),'ankle_world':list(ankle),'foot_axis_world':list(axis)}
 rows.append(frame)
out={'schema':'addams-target-foot-contact-audit.v1','rig':'rotation-candidate.blend','mesh':mesh.name,'rows':rows,'ground_rule':'target-rig sole minimum z; source contact labels select interval only','limits':['Mesh cluster radius is a diagnostic heuristic.','No source pixel or shoe proxy point enters the sole geometry.','Ground z is measured in this candidate pose and must be canonicalized in rig rest/world space before production IK.']}
(O/'target-foot-contact-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2),flush=True)
