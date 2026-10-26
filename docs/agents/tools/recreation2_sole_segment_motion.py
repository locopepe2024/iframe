"""Read-only source-PTS foot-patch motion; no IK or contact fitting."""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector, Quaternion
sys.path.insert(0,str(Path(__file__).parent))
import render_full_motion_bundle as renderer
p=argparse.ArgumentParser()
for k in ('rig','bundle','anchors','out'):p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
bundle=json.loads(Path(a.bundle).read_text());anchors=json.loads(Path(a.anchors).read_text())
bpy.ops.wm.open_mainfile(filepath=a.rig)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=bpy.data.objects['white-model-neutral-female-03']
if arm.animation_data:arm.animation_data_clear()
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion()
bpy.context.view_layer.update()
def positions():
 ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());data=ev.to_mesh();ps=[ev.matrix_world@v.co for v in data.vertices];ev.to_mesh_clear();return ps
ps=positions();patches={}
for side in ('l','r'):
 groups={g.index for g in mesh.vertex_groups if g.name in {f'DEF_foot_{side}',f'toe_{side}',f'toe_attachment_{side}'}}
 ids=[v.index for v in mesh.data.vertices if max((g.weight for g in v.groups if g.group in groups),default=0)>=.2]
 zmin=min(ps[i].z for i in ids);ids=[i for i in ids if ps[i].z<=zmin+.008]
 axis=arm.matrix_world.to_3x3()@(arm.pose.bones['toe_'+side].head-arm.pose.bones['ankle_'+side].head);axis.z=0;axis.normalize()
 ordered=sorted(ids,key=lambda i:ps[i].dot(axis));n=max(1,len(ids)//3)
 patches[side]={'all':ids,'rear_candidate':ordered[:n],'front_candidate':ordered[-n:]}
root=bpy.data.objects.new('sole-segment-readonly-root',None);bpy.context.collection.objects.link(root);arm.parent=root
renderer.apply_bundle(bundle,arm)
rows=[]
for anchor in anchors:
 if anchor.get('kind')=='hold_until_next_pts':continue
 bpy.context.scene.frame_set(anchor['new_bundle_frame']);bpy.context.view_layer.update();ps=positions();feet={}
 for side in ('l','r'):
  parts={}
  for part,ids in patches[side].items():
   center=sum((ps[i] for i in ids),Vector())/len(ids)
   parts[part]={'centroid':list(center),'min_z':min(ps[i].z for i in ids),'max_z':max(ps[i].z for i in ids)}
  f=Vector(parts['front_candidate']['centroid']);r=Vector(parts['rear_candidate']['centroid']);d=f-r
  feet[side]={'patches':parts,'longitudinal_tilt_deg':math.degrees(math.atan2(d.z,math.hypot(d.x,d.y)))}
 rows.append(dict(anchor,feet=feet))
intervals=[]
for prev,cur in zip(rows,rows[1:]):
 dt=cur['source_pts_s']-prev['source_pts_s'];assert dt>0
 metrics={}
 for side in ('l','r'):
  metrics[side]={}
  for part in patches[side]:
   a0=prev['feet'][side]['patches'][part]['centroid'];a1=cur['feet'][side]['patches'][part]['centroid']
   metrics[side][part]={'horizontal_displacement':math.dist(a0[:2],a1[:2]),'horizontal_speed':math.dist(a0[:2],a1[:2])/dt,'vertical_displacement':a1[2]-a0[2]}
 intervals.append({'source_from':prev['source_frame'],'source_to':cur['source_frame'],'dt_s':dt,'feet':metrics})
support=[]
for first,last,side in [(17,37,'l'),(43,55,'r')]:
 subset=[r for r in rows if first<=r['source_frame']<=last];ints=[r for r in intervals if first<=r['source_from'] and r['source_to']<=last]
 metric={}
 for part in patches[side]:
  speeds=sorted(r['feet'][side][part]['horizontal_speed'] for r in ints);zs=[r['feet'][side]['patches'][part]['min_z'] for r in subset]
  start=subset[0]['feet'][side]['patches'][part]['centroid'];end=subset[-1]['feet'][side]['patches'][part]['centroid']
  metric[part]={'speed_median':(speeds[(len(speeds)-1)//2]+speeds[len(speeds)//2])/2,'speed_max':max(speeds),'horizontal_path':sum(r['feet'][side][part]['horizontal_displacement'] for r in ints),'horizontal_net':math.dist(start[:2],end[:2]),'min_z_range':[min(zs),max(zs)]}
 tilts=[r['feet'][side]['longitudinal_tilt_deg'] for r in subset]
 support.append(dict(source_first=first,source_last=last,side=side,count=len(subset),metrics=metric,tilt_range_deg=[min(tilts),max(tilts)]))
report={'schema':'recreation2-sole-segment-motion.v1','blender':bpy.app.version_string,'sha256':{k:hashlib.sha256(Path(getattr(a,k)).read_bytes()).hexdigest() for k in ('rig','bundle','anchors')},'patch_ids':patches,'rows':rows,'intervals':intervals,'support_candidates':support,'limits':['Baseline target-rig motion only, not source 3D truth','Front/rear are geometric thirds, no material/sole contact certification','Source PTS finite differences across sampled anchors, not dense source-frame tracking','Support intervals from existing visual candidates, no force inference','No IK, ground fit, source camera fit or H3 execution']}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('SOLE_SEGMENT_PASS',len(rows),json.dumps(support))
