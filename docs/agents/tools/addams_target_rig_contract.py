"""Export a canonical target-rig foot/ground contract from the original Blender asset."""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Vector
RIG=Path('/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend')
OUT=Path('/tmp/addams-pose/gvhmr-native-v1');OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(RIG));scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update();arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=max((o for o in bpy.data.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices));arm.data.pose_position='REST';bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();em=mesh.evaluated_get(deps);verts=[mesh.matrix_world@v.co for v in em.data.vertices]
def bone(n):
 b=arm.data.bones[n];return {'head_rest_world':list(arm.matrix_world@b.head_local),'tail_rest_world':list(arm.matrix_world@b.tail_local),'length':b.length,'parent':b.parent.name if b.parent else None,'matrix_local':[list(r) for r in b.matrix_local]}
bones={n:bone(n) for n in ['pelvis','upper_leg_l','lower_leg_l','ankle_l','foot_l','toe_l','upper_leg_r','lower_leg_r','ankle_r','foot_r','toe_r'] if n in arm.data.bones};feet={}
for s in ['l','r']:
 ankle=Vector(bones['ankle_'+s]['head_rest_world']);toe=Vector(bones['toe_'+s]['tail_rest_world']);axis=(toe-ankle).normalized();cluster=[]
 for v in verts:
  rel=v-ankle;along=rel.dot(axis);lat=(rel-axis*along).length
  other=Vector(bones['ankle_'+('r' if s=='l' else 'l')]['head_rest_world'])
  if -.18<=along<=.34 and lat<.22 and (v-ankle).length < (v-other).length:cluster.append(v)
 floor=min(v.z for v in cluster);sole=[v for v in cluster if v.z<=floor+.025];heel=min(sole,key=lambda v:(v-ankle).dot(axis));fore=max(sole,key=lambda v:(v-ankle).dot(axis));feet[s]={'cluster_vertex_indices':[i for i,v in enumerate(verts) if v in cluster],'cluster_count':len(cluster),'sole_min_z':floor,'heel_rest_world':list(heel),'forefoot_rest_world':list(fore),'toe_bone_tail_rest_world':list(toe),'axis_rest_world':list(axis),'sole_plane_normal':[0,0,1]}
ground=min(v['sole_min_z'] for v in feet.values())
checks={}
for s in ['l','r']:
 f=feet[s];inv=(arm.matrix_world@arm.data.bones['foot_'+s].matrix_local).inverted()
 f['proxies_foot_local']={key:list(inv@Vector(f[key+'_rest_world'])) for key in ['heel','forefoot']}
 checks[s+'_same_side']=all(Vector(f[key+'_rest_world']).x * bones['ankle_'+s]['head_rest_world'][0]>0 for key in ['heel','forefoot'])
 checks[s+'_proxy_roundtrip']=max(((arm.matrix_world@arm.data.bones['foot_'+s].matrix_local)@Vector(local)-Vector(f[key+'_rest_world'])).length for key,local in f['proxies_foot_local'].items())<1e-5
checks['disjoint_clusters']=not bool(set(feet['l']['cluster_vertex_indices'])&set(feet['r']['cluster_vertex_indices']))
assert all(checks.values()),checks
out={'schema':'addams-target-rig-contract.v2','checks':checks,'rig_path':str(RIG),'rig_sha256':hashlib.sha256(RIG.read_bytes()).hexdigest(),'armature':arm.name,'mesh':mesh.name,'unit_scale':scene.unit_settings.scale_length,'axis_note':'Blender world Z is target ground-up candidate; source pixels are not used.','bones':bones,'feet':feet,'ground_plane_candidate':{'normal':[0,0,1],'offset_z':ground,'source':'minimum canonical sole z'},'limits':['Sole proxies use a mesh-cluster heuristic and require visual rig review.','Ground candidate is a target-asset rest-pose reference, not source-scene ground truth.','No source camera, pixels or contact labels enter this contract.']}
(OUT/'target-rig-contract.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2),flush=True)
