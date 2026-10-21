"""Camera-ray torso endpoint feasibility and two-bone diagnostic; no production changes."""
import argparse,copy,hashlib,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
import render_full_motion_bundle as renderer
from bpy_extras.object_utils import world_to_camera_view
p=argparse.ArgumentParser()
for k in ('rig','bundle','track','anchors','patches','out'):p.add_argument('--'+k,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
bundle=json.loads(Path(a.bundle).read_text());track={f['source_frame']:f['semantic_joints'] for f in json.loads(Path(a.track).read_text())['frames']};anchors=json.loads(Path(a.anchors).read_text());patches=json.loads(Path(a.patches).read_text())['patch_vertex_ids']
helper=Path(__file__).with_name('recreation2_two_bone_ik_probe.py');ns={'__file__':str(helper)};exec(compile(helper.read_text().split('parser = argparse.ArgumentParser()')[0],str(helper),'exec'),ns)
PARTS={'shoulder':'upper_arm','elbow':'lower_arm','wrist':'wrist','hip':'upper_leg','knee':'lower_leg','ankle':'ankle'}
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def stats(v):
 v=sorted(v)
 def q(p):
  x=(len(v)-1)*p;i=math.floor(x);j=math.ceil(x);return v[i]+(v[j]-v[i])*(x-i)
 return dict(count=len(v),median=q(.5),p95=q(.95),max=v[-1])
def setup():
 bpy.ops.wm.open_mainfile(filepath=a.rig);arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
 if arm.animation_data:arm.animation_data_clear()
 for b in arm.pose.bones:
  assert not b.constraints;b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
 root=bpy.data.objects.new('director-motion-root',None);bpy.context.collection.objects.link(root);arm.parent=root;renderer.setup_scene(bundle,out)
 ns.update(arm=arm,root=root,mesh=bpy.data.objects['white-model-neutral-female-03'],bundle=bundle,patches=patches,PARTS=PARTS)
 return arm,root
head=lambda n:ns['head'](n)
rot=lambda n:ns['rotation'](n)
def center(part):return (head(PARTS[part]+'_l')+head(PARTS[part]+'_r'))*.5
def proj(v):return Vector(ns['project'](v))
def snapshot(f):return {'output_frame':f,'pixels':ns['joint_pixels'](),'patch_world':{s:list(ns['patch_center'](s)) for s in ('l','r')}}
def solve_torso(requested):
 A,B,C=[head(n).copy() for n in ('spine_lower','spine_mid','spine_chest')];la=(B-A).length;lb=(C-B).length;axis=requested-A;distance=axis.length
 if distance<1e-8:raise ValueError('torso target coincides with origin')
 axis.normalize();reach=min(la+lb-1e-7,max(abs(la-lb)+1e-7,distance));end=A+axis*reach;pole=B-A-axis*(B-A).dot(axis)
 if pole.length<1e-8:raise ValueError('degenerate torso pole; no fallback')
 pole.normalize();along=(la*la-lb*lb+reach*reach)/(2*reach);knee=A+axis*along+pole*math.sqrt(max(0,la*la-along*along));chest_rotation=rot('spine_chest').copy()
 ns['aim']('spine_lower',knee-A);ns['aim']('spine_mid',end-head('spine_mid'));ns['rotate_world']('spine_chest',chest_rotation@rot('spine_chest').inverted())
 err=(head('spine_chest')-end).length;le=max(abs((head('spine_mid')-head('spine_lower')).length-la),abs((head('spine_chest')-head('spine_mid')).length-lb));assert err<1e-5 and le<1e-5
 dot=max(-1,min(1,(head('spine_mid')-head('spine_lower')).normalized().dot((head('spine_chest')-head('spine_mid')).normalized())))
 return {'endpoint_error_units':err,'bone_length_error_units':le,'unreachable_units':abs(distance-reach),'chain_bend_deg':math.degrees(math.acos(dot)),'chest_full_rotation_error_deg':math.degrees(rot('spine_chest').rotation_difference(chest_rotation).angle)}
def target_on_ray(pixel, extend=False):
 cam=bpy.context.scene.camera;scene=bpy.context.scene;origin=cam.matrix_world.translation;unit=cam.matrix_world@Vector((0,0,-1));cp=proj(unit);fx=proj(cam.matrix_world@Vector((1,0,-1))).x-cp.x;fy=cp.y-proj(cam.matrix_world@Vector((0,1,-1))).y
 direction=cam.matrix_world.to_quaternion()@Vector(((pixel.x-cp.x)/fx,-(pixel.y-cp.y)/fy,-1));direction.normalize()
 shoulder=center('shoulder');chest=head('spine_chest');offset=shoulder-chest;line_origin=origin-offset;A=head('spine_lower');B=head('spine_mid');la=(B-A).length;lb=(chest-B).length;outer=la+lb-1e-7;inner=abs(la-lb)+1e-7
 # Shifted ray parameter and reachable sphere shell, with camera-forward t>=0.
 w=line_origin-A;tc=-w.dot(direction);perp2=max(0,w.length_squared-tc*tc);disc=outer*outer-perp2;feasible=disc>=0 and tc+math.sqrt(max(0,disc))>=0
 tnear=max(0,(shoulder-origin).dot(direction));intervals=[]
 if feasible:
  lo=max(0,tc-math.sqrt(disc));hi=tc+math.sqrt(disc);innerdisc=inner*inner-perp2
  if innerdisc>0:
   il,ih=tc-math.sqrt(innerdisc),tc+math.sqrt(innerdisc)
   intervals=[(lo,min(hi,il)),(max(lo,ih),hi)];intervals=[v for v in intervals if v[1]>=v[0]]
  else:intervals=[(lo,hi)]
  feasible=bool(intervals)
 if feasible:
  candidates=([max(0,tc-math.sqrt(disc)),tc+math.sqrt(disc)] if extend and tc-math.sqrt(disc)>=0 else [tc+math.sqrt(disc)] if extend else [min(hi,max(lo,tnear)) for lo,hi in intervals]);t=min(candidates,key=lambda t:abs(t-tnear))
 else:t=max(0,tc)
 desired=line_origin+direction*t
 return desired,{'source_target_px':list(pixel),'ray_shell_intersects':feasible,'closest_ray_distance_to_chain_origin_units':math.sqrt(perp2),'chain_inner_radius_units':inner,'chain_outer_radius_units':outer,'chosen_ray_depth_units':t,'baseline_shoulder_ray_depth_units':tnear,'target_chest_displacement_units':(desired-chest).length,'baseline_shoulder_center_px':list(proj(shoulder))}
report={'schema':'recreation2-torso-endpoint.v1','sha256':{k:digest(getattr(a,k)) for k in ('rig','bundle','track','anchors','patches')},'probe_sha256':digest(__file__),'renderer_sha256':digest(renderer.__file__),'helper_sha256':digest(helper),'limits':['2D midpoint is estimator evidence, not source 3D center','No joint limits or source depth truth','Ray-shell intersection is geometry only','No source floor/contact truth'],'cases':{}}
for label in ('baseline','absolute_shoulder','hip_relative_shoulder','absolute_shoulder_extended'):
 arm,root=setup();baked=[];expected={};key_rows=[];maxzero=0;maxlower=0
 for anchor,fd in zip(anchors,bundle['frames'],strict=True):
  assert fd['frame']==anchor['new_bundle_frame'];sf=anchor['source_frame'];j=track[sf];ns['load_pose'](fd);before=ns['joint_pixels']();pose=copy.deepcopy(fd);shoulder_px=Vector(((j['left_shoulder'][0]+j['right_shoulder'][0])*320,(j['left_shoulder'][1]+j['right_shoulder'][1])*180));hip_px=Vector(((j['left_hip'][0]+j['right_hip'][0])*320,(j['left_hip'][1]+j['right_hip'][1])*180))
  if label=='hip_relative_shoulder':shoulder_px+= (Vector(before['left_hip'])+Vector(before['right_hip']))*.5-hip_px
  requested,audit=target_on_ray(shoulder_px, label=='absolute_shoulder_extended');audit.update(source_frame=sf,output_frame=fd['frame'],kind=anchor.get('kind','source'))
  old_chest=head('spine_chest').copy();old_rotation=rot('spine_chest').copy()
  zero=solve_torso(old_chest);audit['baseline_chain_bend_deg']=zero['chain_bend_deg'];audit['chain_world_before']={n:list(head(n)) for n in ('spine_lower','spine_mid','spine_chest')};zerr=max(math.dist(v,before[k]) for k,v in ns['joint_pixels']().items());assert zerr<.01;maxzero=max(maxzero,zerr);ns['load_pose'](fd)
  if label!='baseline':
   audit.update(solve_torso(requested));after=ns['joint_pixels']();lower=max(math.dist(v,before[k]) for k,v in after.items() if k.endswith(('hip','knee','ankle')));assert lower<.01;maxlower=max(maxlower,lower)
   audit['after_shoulder_center_px']=list((Vector(after['left_shoulder'])+Vector(after['right_shoulder']))*.5);audit['after_shoulder_world_midpoint_projection_px']=list(proj(center('shoulder')));audit['actual_chest_displacement_units']=(head('spine_chest')-old_chest).length
   for n in ('spine_lower','spine_mid','spine_chest'):
    q=arm.pose.bones[n].rotation_quaternion;pose['localQuaternions'][n]=[q.x,q.y,q.z,q.w]
  audit['chain_world_after']={n:list(head(n)) for n in ('spine_lower','spine_mid','spine_chest')}
  expected[fd['frame']]=snapshot(fd['frame']);key_rows.append(audit);baked.append(pose)
 output_bundle=dict(bundle,frames=baked,review_status='diagnostic_only',request_id='recreation2-torso-'+label);(out/(label+'.bundle.json')).write_text(json.dumps(output_bundle,indent=2)+'\n');arm,root=setup();renderer.apply_bundle(output_bundle,arm);output=[];rt=[]
 for f in range(1,49):
  bpy.context.scene.frame_set(f);ns['update']();row=snapshot(f)
  if f in expected:rt.append(max(math.dist(v,expected[f]['pixels'][k]) for k,v in row['pixels'].items()))
  if output:
   row['joint_steps_px']={k:math.dist(v,output[-1]['pixels'][k]) for k,v in row['pixels'].items()};row['patch_horizontal_speed_units_per_s']={s:math.dist(v[:2],output[-1]['patch_world'][s][:2])*24 for s,v in row['patch_world'].items()}
  output.append(row)
 assert max(rt)<.01;obs=[]
 for anchor in anchors:
  if anchor.get('kind')=='hold_until_next_pts':continue
  sf=anchor['source_frame'];pixels=output[anchor['new_bundle_frame']-1]['pixels'];err={k:math.dist(v,[track[sf][k][0]*640,track[sf][k][1]*360]) for k,v in pixels.items()};obs.append(dict(anchor,mean_px=sum(err.values())/12,per_joint_px=err))
 summary={'all_joint_error_px':stats([e for r in obs for e in r['per_joint_px'].values()]),'ankle_error_px':stats([e for r in obs for k,e in r['per_joint_px'].items() if k.endswith('_ankle')]),'shoulder_error_px':stats([e for r in obs for k,e in r['per_joint_px'].items() if k.endswith('_shoulder')]),'selected_source_mean_px':{r['source_frame']:r['mean_px'] for r in obs if r['source_frame'] in (1,17,23,29,41,55)},'ray_shell_intersects_count':sum(r['ray_shell_intersects'] for r in key_rows if r['kind']=='source'),'independent_source_count':28,'renderer_roundtrip_max_px':max(rt),'zero_target_max_px':maxzero,'unchanged_lower_max_px':maxlower,'output_max_joint_step_px':stats([max(r['joint_steps_px'].values()) for r in output[1:]]),'key_diagnostics':key_rows}
 report['cases'][label]={'summary':summary,'source_observations':obs,'output':output};print(label,json.dumps(summary))
assert all(digest(getattr(a,k))==v for k,v in report['sha256'].items());(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');(out/'summary.json').write_text(json.dumps({k:v for k,v in report.items() if k!='cases'}|{'cases':{k:v['summary'] for k,v in report['cases'].items()}},indent=2)+'\n');print('TORSO_ENDPOINT_PROBE_COMPLETE')
