"""First-shot editable continuity candidate, with explicit source/identity gaps."""
import json,hashlib,math,os
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
BASE=Path('/tmp/addams-pose');CASE=os.environ.get('ADDAMS_BODY_CASE','both');OUT=BASE/('body-isolation-'+CASE);OUT.mkdir(exist_ok=True)
RIG=Path('/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend')
obs=json.loads((BASE/'segment-batch-v1/observations.json').read_text())[:65]
reviews=json.loads((BASE/'event-reviewed.json').read_text());review={r['source_frame']:r for r in reviews['frames']}
points=np.full((65,33,3),np.nan);xy=np.full((65,33,2),np.nan);provenance=[]
for i,row in enumerate(obs):
 people=row['mp_people'];sf=i+1;idx=None
 if len(people)==1:idx=0
 elif len(people)>1 and sf in review and review[sf]['identity'].isdigit():
  det=row['independent_people'][int(review[sf]['identity'])];pairs=[(11,5),(12,6),(23,11),(24,12)]
  distances=[sum(np.linalg.norm(np.array([p['landmarks'][a]['x'],p['landmarks'][a]['y']])-np.array(det['coco17_xy'][b])) for a,b in pairs) for p in people];idx=int(np.argmin(distances))
 if idx is not None:
  p=people[idx]
  for j,(w,lm) in enumerate(zip(p['world_landmarks'],p['landmarks'])):
   if min(w['visibility'],lm['visibility'])>=.35:
    points[i,j]=[w[k] for k in 'xyz'];xy[i,j]=[lm['x'],lm['y']]
 provenance.append({'source_frame':sf,'pts_s':row['pts_s'],'mp_candidate_index':idx,'identity_status':'user_anchor_match' if idx is not None and len(people)>1 else 'single_mp_proposal_unverified' if idx is not None else 'missing_or_ambiguous','contact':review.get(sf,{}).get('contact'),'contact_enforced':False})
valid=np.isfinite(points[:,:,0]);original=points.copy()
for j in range(33):
 ok=np.where(valid[:,j])[0]
 if len(ok)<2:raise ValueError(f'Insufficient joint observations {j}')
 for k in range(3):points[:,j,k]=np.interp(np.arange(65),ok,points[ok,j,k])
# Mild symmetric 3-frame smoothing; not motion validation.
points=(np.pad(points,((1,1),(0,0),(0,0)),mode='edge')[:-2]+2*points+np.pad(points,((1,1),(0,0),(0,0)),mode='edge')[2:])/4
body_points=points.copy();excluded=[49,52,53,54,55,56]
for j in [11,12,23,24]:
 good=np.array([i for i in range(65) if i+1 not in excluded])
 for k in range(3):body_points[:,j,k]=np.interp(np.arange(65),good,points[good,j,k])
frozen=json.loads((BASE/'continuous-shot1-v1/report.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(RIG));arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');arm.animation_data_clear();scene=bpy.context.scene
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
def update():bpy.context.view_layer.update()
def head(n):return arm.matrix_world@arm.pose.bones[n].head
def direction(n):return (arm.matrix_world@arm.pose.bones[n].tail-head(n)).normalized()
def mapped(p):return Vector((float(p[0]),float(p[2]),-float(p[1])))
def swing(n,target):
 b=arm.pose.bones[n];basis=(arm.matrix_world@b.matrix).to_quaternion();delta=direction(n).rotation_difference(target.normalized());b.rotation_quaternion=b.rotation_quaternion@(basis.inverted()@delta@basis);update()
update();rest_location=arm.location.copy();rest_hip_axis=(head('upper_leg_l')-head('upper_leg_r')).normalized()
print('BONES',list(arm.pose.bones.keys()),flush=True)
chains=[('upper_leg_l',23,25),('lower_leg_l',25,27),('upper_leg_r',24,26),('lower_leg_r',26,28),('upper_arm_l',11,13),('lower_arm_l',13,15),('upper_arm_r',12,14),('lower_arm_r',14,16)]
assert all(n in arm.pose.bones for n,_,_ in chains)
rigframes=[];centered_offsets=[];previous={}
for i in range(65):
 sf=i+1;scene.frame_set(sf);arm.location=rest_location
 for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0)
 update();v=[mapped(p) for p in points[i]];body=[mapped(p) for p in body_points[i]];pelvis_v=body if CASE in ['pelvis','both'] else v;b=arm.pose.bones['pelvis'];basis=(arm.matrix_world@b.matrix).to_quaternion();delta=rest_hip_axis.rotation_difference((pelvis_v[23]-pelvis_v[24]).normalized());b.rotation_quaternion=basis.inverted()@delta@basis;update()
 torso_v=body if CASE in ['torso','both'] else v
 up=(torso_v[11]+torso_v[12]-torso_v[23]-torso_v[24]).normalized()
 for name,w in [('spine_lower',.35),('spine_mid',.65),('spine_chest',1.)]:swing(name,direction(name).lerp(up,w))
 for n,a,c in chains:swing(n,v[c]-v[a])
 center=(head('upper_leg_l')+head('upper_leg_r'))/2;arm.location-=center;update()
 locations={n:list(head(n)) for n in ['upper_leg_l','upper_leg_r','lower_leg_l','lower_leg_r','ankle_l','ankle_r','upper_arm_l','upper_arm_r','lower_arm_l','lower_arm_r']}
 rigframes.append(locations);centered_offsets.append(arm.location.copy())
 for b in arm.pose.bones:
  if b.name in previous and b.rotation_quaternion.dot(previous[b.name])<0:b.rotation_quaternion.negate()
  previous[b.name]=b.rotation_quaternion.copy();b.keyframe_insert(data_path='rotation_quaternion',frame=sf)
# Fit one projection scale for the whole shot, then image-plane root translation per frame.
pairs=[('upper_leg_l',23),('upper_leg_r',24),('lower_leg_l',25),('lower_leg_r',26),('ankle_l',27),('ankle_r',28),('upper_arm_l',11),('upper_arm_r',12)]
fits=[]
for i,f in enumerate(rigframes):
 data=[(np.array([f[n][0],-f[n][2]]),xy[i,j]) for n,j in pairs if np.isfinite(xy[i,j]).all()]
 if len(data)<4:continue
 a=np.array([x for x,y in data]);b=np.array([y for x,y in data]);ac=a-a.mean(0);bc=b-b.mean(0);s=float((ac*bc).sum()/(ac*ac).sum())
 if s>0:fits.append(s)
scale=frozen['projection_scale_source_px_per_unit'];assert math.isfinite(scale) and scale>0
translations=np.full((65,2),np.nan)
for i,f in enumerate(rigframes):
 offsets=[xy[i,j]-scale*np.array([f[n][0],-f[n][2]]) for n,j in pairs if np.isfinite(xy[i,j]).all()]
 if offsets:translations[i]=np.median(offsets,axis=0)
for k in range(2):
 good=np.where(np.isfinite(translations[:,k]))[0];translations[:,k]=np.interp(np.arange(65),good,translations[good,k])
for i in range(65):
 scene.frame_set(i+1);t=translations[i];arm.location=Vector(frozen['frames'][i]['armature_location']);arm.keyframe_insert(data_path='location',frame=i+1)
 provenance[i]['interpolated_joint_indices']=np.where(~valid[i])[0].tolist();provenance[i]['armature_location']=list(arm.location)
scene.frame_start=1;scene.frame_end=65;scene.render.fps=25
for o in list(bpy.data.objects):
 if o.type in ['CAMERA','LIGHT']:bpy.data.objects.remove(o,do_unlink=True)
cam=bpy.data.objects.new('CandidateCamera',bpy.data.cameras.new('CandidateCamera'));scene.collection.objects.link(cam);cam.location=(0,-10,0);cam.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=3840/scale;scene.camera=cam
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE';scene.display.shading.single_color=(.72,.72,.72);scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True;scene.display.shading.background_type='WORLD';scene.world.color=(.07,.07,.07)
scene.render.resolution_x=480;scene.render.resolution_y=260;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.frame_set(23);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'candidate.blend'))
report={'schema':'addams-body-isolation.v1','case':CASE,'diagnostic_body_interpolated_frames':excluded,'leg_inputs':'unchanged_v1','camera_and_root':'frozen_v1','source_sha256':hashlib.sha256((BASE/'source.mp4').read_bytes()).hexdigest(),'rig_sha256':hashlib.sha256(RIG.read_bytes()).hexdigest(),'review_sha256':hashlib.sha256((BASE/'event-reviewed.json').read_bytes()).hexdigest(),'frames':provenance,'projection_scale_source_px_per_unit':scale,'world_axis_mapping':'MP x,y,z -> Blender x,z,-y; camera-relative hypothesis','limits':['Unverified MP identity on non-anchor frames.','World joint directions are monocular estimates; smoothing and gap interpolation are candidate construction only.','Pelvis uses hip-axis swing; torso twist and foot orientation remain unresolved.','Root is fitted image-plane trajectory; absolute depth/focal length not recovered.','User event labels retained but contact not enforced. Prior five-frame reviewed leg fit not integrated.','Workbench lighting is diagnostic; source lighting and all three quality gates not accepted.']}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
for sf in [49,52,55,56]:scene.frame_set(sf);scene.render.filepath=str(OUT/f'front-{sf:03}.png');bpy.ops.render.render(write_still=True)

metrics=[]
for sf in [49,50,51,52,53,54,55,56,57]:
 scene.frame_set(sf);update();hips=(head('upper_leg_l')+head('upper_leg_r'))/2;shoulders=(head('upper_arm_l')+head('upper_arm_r'))/2;u=(shoulders-hips).normalized();metrics.append({'source_frame':sf,'torso_up_camera_vertical_deg':math.degrees(u.angle(Vector((0,0,1))))})
(OUT/'metrics.json').write_text(json.dumps({'case':CASE,'frames':metrics},indent=2)+'\n')
print('BODY_ISOLATION_COMPLETE',CASE,flush=True)
