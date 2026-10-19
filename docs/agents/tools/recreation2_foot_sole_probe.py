"""Read-only foot sole proxy calibration on the pinned Blender rig."""
import argparse,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
import render_full_motion_bundle as renderer
raw=sys.argv[sys.argv.index('--')+1:]
p=argparse.ArgumentParser();p.add_argument('--rig',required=True);p.add_argument('--bundle',required=True);p.add_argument('--out',required=True);A=p.parse_args(raw)
out=Path(A.out);out.parent.mkdir(parents=True,exist_ok=True)
bundle=json.loads(Path(A.bundle).read_text());bpy.ops.wm.open_mainfile(filepath=A.rig)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');root=bpy.data.objects.new('probe-root',None);bpy.context.collection.objects.link(root);arm.parent=root
obj=next(o for o in bpy.data.objects if o.type=='MESH' and o.name.endswith('-03'))
def groups_for(side):
 names={f'DEF_foot_{side}',f'toe_{side}',f'toe_attachment_{side}',f'foot_{side}'}
 return {g.index for g in obj.vertex_groups if g.name in names}
def summarize(side):
 deps=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(deps);mesh=ev.to_mesh();groups=groups_for(side);vals=[]
 for v in mesh.vertices:
  w=max((g.weight for g in v.groups if g.group in groups),default=0)
  if w>=.20: vals.append((ev.matrix_world@v.co,w,v.index))
 ev.to_mesh_clear()
 if not vals:return {'count':0}
 zmin=min(p.z for p,_,_ in vals);band=max(.008,(max(p.z for p,_,_ in vals)-zmin)*.05);pts=[x for x in vals if x[0].z<=zmin+band]
 c=sum((p for p,_,_ in pts),Vector())/len(pts);head=arm.matrix_world@arm.pose.bones[f'foot_{side}'].head
 return {'count':len(pts),'min_z':min(p.z for p,_,_ in pts),'max_z':max(p.z for p,_,_ in pts),'centroid_world':list(c),'head_world':list(head),'centroid_minus_head':[c[i]-head[i] for i in range(3)],'bounds':[[min(p[i] for p,_,_ in pts) for i in range(3)],[max(p[i] for p,_,_ in pts) for i in range(3)]]}
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update();rest={s:summarize(s) for s in ('l','r')};frames={}
for fd in bundle['frames']:
 renderer.apply_bundle({'frames':[fd],'fps':bundle['fps'],'frame_range':[fd['frame'],fd['frame']],'facing_offset_deg':bundle.get('facing_offset_deg',0)},arm);bpy.context.scene.frame_set(int(fd['frame']));bpy.context.view_layer.update();frames[str(fd['frame'])]={s:summarize(s) for s in ('l','r')}
report={'schema':'recreation2-foot-sole-probe.v1','rig':A.rig,'bundle':A.bundle,'mesh':obj.name,'groups':{s:[g.name for g in obj.vertex_groups if g.index in groups_for(s)] for s in ('l','r')},'rest':rest,'frames':frames};out.write_text(json.dumps(report,indent=2)+'\n');print(out)
