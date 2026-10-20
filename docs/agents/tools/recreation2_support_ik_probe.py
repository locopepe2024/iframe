"""Isolated capped support-sole IK on a frozen retarget candidate."""
import argparse
import copy
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer
p=argparse.ArgumentParser()
for k in ('rig','bundle','track','anchors','patches','supports','out'): p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]); out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
bundle=json.loads(Path(a.bundle).read_text());track={f['source_frame']:f['semantic_joints'] for f in json.loads(Path(a.track).read_text())['frames']}
anchors=json.loads(Path(a.anchors).read_text()); independent=[r for r in anchors if r.get('kind')!='hold_until_next_pts']; by_source={r['source_frame']:r['new_bundle_frame'] for r in independent}
patches=json.loads(Path(a.patches).read_text())['patch_vertex_ids']; supports=json.loads(Path(a.supports).read_text())['support_candidates']
helper=Path(__file__).with_name('recreation2_two_bone_ik_probe.py'); ns={'__file__': str(helper)};exec(compile(helper.read_text().split('parser = argparse.ArgumentParser()')[0],str(helper),'exec'),ns)
PARTS={'shoulder':'upper_arm','elbow':'lower_arm','wrist':'wrist','hip':'upper_leg','knee':'lower_leg','ankle':'ankle'}
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def stats(v):
 v=sorted(v)
 if not v:return None
 def q(p):
  x=(len(v)-1)*p;l=math.floor(x);h=math.ceil(x);return v[l]+(v[h]-v[l])*(x-l)
 return {'count':len(v),'median':q(.5),'p95':q(.95),'max':max(v)}
def setup():
 bpy.ops.wm.open_mainfile(filepath=a.rig)
 arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=bpy.data.objects['white-model-neutral-female-03']
 if arm.animation_data:arm.animation_data_clear()
 for b in arm.pose.bones:
  assert not b.constraints
  b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
 root=bpy.data.objects.new('director-motion-root',None);bpy.context.collection.objects.link(root);arm.parent=root
 renderer.setup_scene(bundle,out);ns.update(arm=arm,mesh=mesh,root=root,bundle=bundle,patches=patches,PARTS=PARTS);return arm,root
def snapshot(f):
 return {'output_frame':f,'pixels':ns['joint_pixels'](),'patch_world':{s:list(ns['patch_center'](s)) for s in ('l','r')}}
arm,root=setup();renderer.apply_bundle(bundle,arm);dense=[];baseline_rows=[]
for f in range(1,49):
 bpy.context.scene.frame_set(f);ns['update']();baseline_rows.append(snapshot(f));qs={}
 for n in bundle['frames'][0]['localQuaternions']:
  q=arm.pose.bones[n].rotation_quaternion;qs[n]=[q.x,q.y,q.z,q.w]
 dense.append(dict(bundle['frames'][0],frame=f,rootPosition=list(root.location),rootYaw=float(root.rotation_euler[2]),localQuaternions=qs))
intervals=[]
for s in supports:
 first,last=by_source[s['source_first']],by_source[s['source_last']];side='l' if s['semantic_side']=='left' else 'r'
 intervals.append(dict(s,side=side,first_output=first,last_output=last,reference_world=baseline_rows[first-1]['patch_world'][side]))
report={'schema':'recreation2-support-ik.v1','sha256':{k:digest(getattr(a,k)) for k in ('rig','bundle','track','anchors','patches','supports')},'probe_sha256':digest(__file__),'ik_helper_sha256':digest(helper),'renderer_sha256':digest(renderer.__file__),'cap_units':.04,'intervals':intervals,'units':'Blender units, metric unverified; pixels 640x360','limits':['Reference is candidate patch at support entry, not recovered ground','Visual support candidate is not force/stationarity truth','No pelvis change; no foot orientation flattening'],'cases':{}}
for label in ('baseline','support_ik'):
 arm,root=setup();baked=[];expected=[];ik_rows=[];max_zero=0;max_unchanged=0
 for fd in dense:
  ns['load_pose'](fd);before=ns['joint_pixels']();f=fd['frame'];row={'output_frame':f,'active':False};pose=copy.deepcopy(fd)
  interval=next((s for s in intervals if s['first_output']<=f<=s['last_output']),None)
  if label=='support_ik' and interval:
   side=interval['side'];suffix='left_' if side=='l' else 'right_';start=interval['first_output'];last=interval['last_output']
   weight=min(1.,(f-start)/2., (last-f)/2. if last<48 else 1.)
   row.update(active=weight>0,side=side,weight=weight)
   ankle0=ns['head']('ankle_'+side).copy();patch0=ns['patch_center'](side);reference=Vector(interval['reference_world']);desired=(reference-patch0)*weight
   cap=min(.04,desired.length); correction=desired.normalized()*cap if desired.length>1e-10 else Vector()
   zero=ns['solve'](side,ankle0);zeroerr=max(math.dist(v,before[k]) for k,v in ns['joint_pixels']().items());assert zeroerr<.01;max_zero=max(max_zero,zeroerr)
   ns['load_pose'](fd);result=ns['solve'](side,ankle0+correction)
   after=ns['joint_pixels']();unchanged=max(math.dist(v,before[k]) for k,v in after.items() if not k.startswith(suffix) or k.split('_',1)[1] in ('shoulder','elbow','wrist','hip'));assert unchanged<.01;max_unchanged=max(max_unchanged,unchanged)
   patch1=ns['patch_center'](side);movement=(ns['head']('ankle_'+side)-ankle0).length;assert movement<.04001
   row.update(result,zero_target_px=zeroerr,unchanged_px=unchanged,requested_patch_correction_units=desired.length,ankle_correction_units=movement,cap_hit=desired.length>.04,patch_reference_residual_units=(patch1-reference).length,patch_height_reference_residual_units=patch1.z-reference.z,patch_target_translation_residual_units=(patch1-patch0-correction).length)
   for n in ('upper_leg_'+side,'lower_leg_'+side,'ankle_'+side,'foot_'+side):
    q=arm.pose.bones[n].rotation_quaternion;pose['localQuaternions'][n]=[q.x,q.y,q.z,q.w]
  expected.append(snapshot(f));ik_rows.append(row);baked.append(pose)
 outbundle=dict(bundle,frames=baked,request_id='recreation2-support-'+label,review_status='diagnostic_only')
 (out/(label+'.bundle.json')).write_text(json.dumps(outbundle,indent=2)+'\n')
 arm,root=setup();renderer.apply_bundle(outbundle,arm);outputs=[];roundtrips=[]
 for f in range(1,49):
  bpy.context.scene.frame_set(f);ns['update']();s=snapshot(f);roundtrips.append(max(math.dist(v,expected[f-1]['pixels'][k]) for k,v in s['pixels'].items()))
  if f>1:
   s['joint_steps_px']={k:math.dist(v,outputs[-1]['pixels'][k]) for k,v in s['pixels'].items()}
   s['patch_horizontal_speed_units_per_s']={side:math.dist(v[:2],outputs[-1]['patch_world'][side][:2])*24 for side,v in s['patch_world'].items()}
  outputs.append(s)
 assert max(roundtrips)<.01
 if label=='baseline':
  exact=max(math.dist(v,baseline_rows[i]['pixels'][k]) for i,s in enumerate(outputs) for k,v in s['pixels'].items());assert exact<.01;report['dense_baseline_reproduction_max_px']=exact
 observations=[]
 for anchor in independent:
  sf=anchor['source_frame'];pix=outputs[anchor['new_bundle_frame']-1]['pixels'];err={k:math.dist(v,[track[sf][k][0]*640,track[sf][k][1]*360]) for k,v in pix.items()};observations.append(dict(anchor,mean_px=sum(err.values())/12,per_joint_px=err))
 support_metrics=[]
 for s in intervals:
  first,last=s['first_output'],s['last_output'];side=s['side'];ref=s['reference_world'];sample=outputs[first-1:last]
  # Include support entry/exit boundary displacement in the report, not just fully locked samples.
  support_metrics.append(dict(s,horizontal_speed=stats([o['patch_horizontal_speed_units_per_s'][side] for o in sample if 'patch_horizontal_speed_units_per_s' in o]),reference_distance=stats([math.dist(o['patch_world'][side],ref) for o in sample]),height_reference_abs=stats([abs(o['patch_world'][side][2]-ref[2]) for o in sample]),active_ankle_error_px=stats([o['per_joint_px'][s['semantic_side']+'_ankle'] for o in observations if s['source_first']<=o['source_frame']<=s['source_last']]),min_patch_center_height_relative_to_entry=min(o['patch_world'][side][2]-ref[2] for o in sample)))
 summary={'all_joint_error_px':stats([e for o in observations for e in o['per_joint_px'].values()]),'ankle_error_px':stats([e for o in observations for k,e in o['per_joint_px'].items() if k.endswith('_ankle')]),'selected_source_mean_px':{o['source_frame']:o['mean_px'] for o in observations if o['source_frame'] in (1,17,23,29,41,55)},'output_max_joint_step_px':stats([max(o['joint_steps_px'].values()) for o in outputs[1:]]),'renderer_roundtrip_max_px':max(roundtrips),'zero_target_max_px':max_zero,'unchanged_upper_and_other_leg_max_px':max_unchanged,'cap_hit_count':sum(o.get('cap_hit',False) for o in ik_rows),'support_metrics':support_metrics}
 report['cases'][label]={'summary':summary,'source_observations':observations,'output':outputs,'ik':ik_rows};print(label,json.dumps(summary))
assert all(digest(getattr(a,k))==v for k,v in report['sha256'].items())
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');(out/'summary.json').write_text(json.dumps({k:v for k,v in report.items() if k!='cases'}|{'cases':{k:v['summary'] for k,v in report['cases'].items()}},indent=2)+'\n');print('SUPPORT_IK_PROBE_COMPLETE')
