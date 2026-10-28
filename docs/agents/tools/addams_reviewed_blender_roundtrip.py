"""Rebuild reviewed leg directions on pinned rig; export editable actions."""
import json, math, hashlib
from pathlib import Path
import bpy
from mathutils import Vector, Quaternion

BASE=Path('/tmp/addams-annotation-check')
RIG=Path('/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend')
data=json.loads((BASE/'contour-candidates-v2.json').read_text())
prior=json.loads(Path('/tmp/addams-pose/distributed-control.json').read_text())
world=json.loads(Path('/tmp/addams-pose/world-candidate.json').read_text())
refs={r['source_frame']:r for r in prior['rows'] if r['case']=='distributed_swing'}
worlds={r['source_frame']:r for r in world['frames']}
OUT=BASE/'blender-roundtrip-v2';OUT.mkdir(exist_ok=True)

def update():bpy.context.view_layer.update()
def head(n):return arm.matrix_world@arm.pose.bones[n].head
def mapped(p):return Vector((p[0],p[2],-p[1]))
def xyzw(q):return [q.x,q.y,q.z,q.w]

bpy.ops.wm.open_mainfile(filepath=str(RIG));arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
arm.animation_data_clear();initial_location=arm.location.copy();actions=[];rows=[]
foot_bones=[b.name for b in arm.pose.bones if any(s in b.name.lower() for s in ['ankle','toe','foot'])]
for candidate in data['candidates']:
    weight=candidate['temporal_weight'];action=bpy.data.actions.new(f'reviewed_legs_temporal_{weight}');action.use_fake_user=True
    arm.animation_data_create();arm.animation_data.action=action
    for f in candidate['frames']:
        sf=f['source_frame'];bpy.context.scene.frame_set(sf);arm.location=initial_location
        for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
        ref=refs[sf];q=ref['pelvis_xyzw'];arm.pose.bones['pelvis'].rotation_quaternion=(q[3],q[0],q[1],q[2]);update()
        for si,suffix in enumerate(['l','r']):
            for j,name in enumerate(['upper_leg','lower_leg']):
                bone=arm.pose.bones[name+'_'+suffix];desired=mapped(f['leg_unit_directions'][si][j]).normalized()
                current=(arm.matrix_world@bone.tail-head(bone.name)).normalized();delta=current.rotation_difference(desired)
                basis=(arm.matrix_world@bone.matrix).to_quaternion();bone.rotation_quaternion=basis.inverted()@delta@basis;update()
        # Preserve the original distributed torso procedure; arms remain diagnostic rest pose.
        pts=worlds[sf]['pose_world_landmarks'][0];v=[mapped([p[k] for k in 'xyz']) for p in pts];up=(v[11]+v[12]-v[23]-v[24]).normalized()
        for name,w in [('spine_lower',.35),('spine_mid',.65),('spine_chest',1.)]:
            bone=arm.pose.bones[name];current=(arm.matrix_world@bone.tail-head(name)).normalized();desired=current.lerp(up,w).normalized();basis=(arm.matrix_world@bone.matrix).to_quaternion()
            bone.rotation_quaternion=bone.rotation_quaternion@(basis.inverted()@current.rotation_difference(desired)@basis);update()
        center=(head('upper_leg_l')+head('upper_leg_r'))/2
        actual={};gaps=[]
        for side,suffix in [('left','l'),('right','r')]:
            for part,bone in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:
                p=head(bone+'_'+suffix)-center;point=[p.x,-p.z,p.y];actual[side+'_'+part]=point
                gaps.append((Vector(point)-Vector(f['xyz_right_down_forward'][side+'_'+part])).length)
        assert max(gaps)<1e-5,(weight,sf,max(gaps))
        # Shift entire rig so camera-space joint centers match fitted translation.
        shift=mapped(f['translation'])-center;arm.location+=shift;update()
        feet={n:{'head':list(head(n)),'tail':list(arm.matrix_world@arm.pose.bones[n].tail)} for n in foot_bones}
        for b in arm.pose.bones:
            if sf>20:
                # Sign continuity preserves quaternion interpolation across equivalent q/-q.
                prev=previous.get(b.name)
                if prev is not None and b.rotation_quaternion.dot(prev)<0:b.rotation_quaternion.negate()
            b.keyframe_insert(data_path='rotation_quaternion',frame=sf)
        previous={b.name:b.rotation_quaternion.copy() for b in arm.pose.bones}
        arm.keyframe_insert(data_path='location',frame=sf)
        rows.append({'temporal_weight':weight,'source_frame':sf,'endpoint_max_error_units':max(gaps),'foot_bones_camera_world':feet,
                     'local_quaternions_xyzw':{b.name:xyzw(b.rotation_quaternion) for b in arm.pose.bones},'armature_location':list(arm.location)})
    actions.append({'name':action.name,'weight':weight,'frames':[20,24]})
# Re-evaluate keyed actions rather than trusting immediate pose assignments.
replay_errors=[]
for action_info,candidate in zip(actions,data['candidates']):
    arm.animation_data.action=bpy.data.actions[action_info['name']]
    for f in candidate['frames']:
        bpy.context.scene.frame_set(f['source_frame']);update()
        for side,suffix in [('left','l'),('right','r')]:
            for part,bone in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:
                expected=mapped([x+y for x,y in zip(f['xyz_right_down_forward'][side+'_'+part],f['translation'])])
                replay_errors.append((head(bone+'_'+suffix)-expected).length)
assert max(replay_errors)<1e-5,max(replay_errors)
arm.animation_data.action=bpy.data.actions[actions[1]['name']]
scene=bpy.context.scene;scene.frame_start=20;scene.frame_end=24;scene.render.fps=25
cam=bpy.data.objects.new('ReviewedDiagnosticCamera',bpy.data.cameras.new('ReviewedDiagnosticCamera'));scene.collection.objects.link(cam)
cam.location=(0,0,0);cam.rotation_euler=Vector((0,1,0)).to_track_quat('-Z','Y').to_euler();cam.data.type='PERSP';cam.data.sensor_fit='HORIZONTAL';cam.data.sensor_width=36;cam.data.lens=36
scene.camera=cam;scene.render.resolution_x=960;scene.render.resolution_y=520;scene.render.resolution_percentage=100
scene.frame_set(24);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'reviewed-leg-candidates.blend'))
report={'rig_sha256':hashlib.sha256(RIG.read_bytes()).hexdigest(),'candidate_sha256':hashlib.sha256((BASE/'contour-candidates-v2.json').read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'action_replay_max_error_units':max(replay_errors),'actions':actions,'rows':rows,'foot_bones':foot_bones,'endpoint_max_error_units':max(r['endpoint_max_error_units'] for r in rows),
        'limits':['Foot bone endpoints are not verified sole proxy points.','Root location is diagnostic camera-relative translation, not world trajectory.','Legs plus prior torso only; arms remain rest pose, no full animation acceptance.','No foot orientation recovery, floor, contact enforcement or mesh render.']}
(OUT/'roundtrip.json').write_text(json.dumps(report,indent=2)+'\n');print('ROUNDTRIP_COMPLETE',report['endpoint_max_error_units'],foot_bones)
