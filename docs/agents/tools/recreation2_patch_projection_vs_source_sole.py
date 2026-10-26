"""Read-only target patch/foot point projection vs source 2D shoe proxy."""
import argparse, json, math, sys, hashlib
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector, Quaternion
sys.path.insert(0,str(Path(__file__).parent));import render_full_motion_bundle as renderer
p=argparse.ArgumentParser()
for k in ('rig','bundle','anchors','source','out'):p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
bundle=json.loads(Path(a.bundle).read_text());anchors={x['source_frame']:x for x in json.loads(Path(a.anchors).read_text())};src=json.loads(Path(a.source).read_text())['rows'];src={x['frame']:x for x in src}
bpy.ops.wm.open_mainfile(filepath=a.rig);arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=bpy.data.objects['white-model-neutral-female-03']
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion()
root=bpy.data.objects.new('patch-proj-root',None);bpy.context.collection.objects.link(root);arm.parent=root
renderer.setup_scene(bundle,out);renderer.apply_bundle(bundle,arm)
def positions():
 ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());d=ev.to_mesh();r=[ev.matrix_world@v.co for v in d.vertices];ev.to_mesh_clear();return r
def project(p):
 q=world_to_camera_view(bpy.context.scene,bpy.context.scene.camera,p);return [q.x*640,(1-q.y)*360]
ps=positions();patch={}
for s in ('l','r'):
 groups={g.index for g in mesh.vertex_groups if g.name in {f'DEF_foot_{s}',f'toe_{s}',f'toe_attachment_{s}'}}
 ids=[v.index for v in mesh.data.vertices if max((g.weight for g in v.groups if g.group in groups),default=0)>=.2];z=min(ps[i].z for i in ids);ids=[i for i in ids if ps[i].z<=z+.008];patch[s]=ids
rows=[]
for sf in (1,17,23,29,41,55):
 fd=next(f for f in bundle['frames'] if f['frame']==anchors[sf]['new_bundle_frame']);renderer.apply_bundle(dict(bundle,frames=[fd],frame_range=[fd['frame'],fd['frame']]),arm);bpy.context.scene.frame_set(fd['frame']);bpy.context.view_layer.update();ps=positions();
 for side,s in [('left','l'),('right','r')]:
  ankle=project(arm.matrix_world@arm.pose.bones[f'ankle_{s}'].head);toe=project(arm.matrix_world@arm.pose.bones[f'toe_{s}'].head);foot=project(arm.matrix_world@arm.pose.bones[f'foot_{s}'].head);patchxy=project(sum((ps[i] for i in patch[s]),Vector())/len(patch[s]));obs=[v*scale for v,scale in zip(src[sf][side]['sole_proxy_xy_px'],[640/1394,360/792])]
  rows.append({'source_frame':sf,'output_frame':fd['frame'],'side':side,'source_sole_proxy_640x360':obs,'target_points_px':{'ankle':ankle,'foot':foot,'toe':toe,'patch':patchxy},'errors_px':{k:math.dist(v,obs) for k,v in {'ankle':ankle,'foot':foot,'toe':toe,'patch':patchxy}.items()},'source_visibility':src[sf][side]['visibility']})
report={'schema':'recreation2-patch-projection-vs-source-sole.v1','rig_sha256':hashlib.sha256(Path(a.rig).read_bytes()).hexdigest(),'source_report_sha256':hashlib.sha256(Path(a.source).read_bytes()).hexdigest(),'rows':rows,'limits':['Source heel/toe midpoint is 2D image proxy, not physical contact','Target patch is fixed rest lowest mesh band','No camera/metric depth or H3 validation','No production changes']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('PATCH_PROJECTION_PASS',len(rows))
