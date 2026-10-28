"""Media Blender: same-camera direction/full-rotation diagnostic; no contact fit."""
import bpy, json, math
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

O=Path('/tmp/addams-pose/gvhmr-native-v1')
d=json.loads((O/'native-layer-input.json').read_text())
rig='/home/ubuntu/director-deploy-r2/assets/characters/white-model-neutral-female-v1/blender/white-model-neutral-female-v1.blend'
bpy.ops.wm.open_mainfile(filepath=rig)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
arm.animation_data_clear(); scene=bpy.context.scene
assert all(not b.constraints for b in arm.pose.bones)
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
# Camera x right/y down/z forward -> Blender x right/y backward/z down.
# Use x,-z,y (proper rotation) with camera up = -Z. This preserves handedness.
assert abs(C.determinant()-1)<1e-8
rest={b.name:b.matrix_local.copy() for b in arm.data.bones}
bind={'pelvis':0,'upper_leg_l':1,'upper_leg_r':2,'spine_lower':3,
      'lower_leg_l':4,'lower_leg_r':5,'spine_mid':6,'ankle_l':7,'ankle_r':8,
      'spine_chest':9,'foot_l':10,'foot_r':11,'neck':12,'clavicle_l':13,
      'clavicle_r':14,'head':15,'upper_arm_l':16,'upper_arm_r':17,
      'lower_arm_l':18,'lower_arm_r':19,'wrist_l':20,'wrist_r':21}
bind={n:i for n,i in bind.items() if n in arm.pose.bones}
parents=d['parents']; p=d['params']; N=len(d['frame_map']['frames'])
def aa(v):
    v=Vector(v);return Quaternion(v.normalized(),v.length).to_matrix() if v.length>1e-10 else Matrix.Identity(3)
def update():bpy.context.view_layer.update()
def pos(n):return arm.matrix_world@arm.pose.bones[n].head
def src(i,j):return C@Vector(d['native22'][i][j])
length=lambda a,b:(rest[a].translation-rest[b].translation).length
sr=[Vector(v) for v in d['rest22']]
scale=(length('upper_leg_l','lower_leg_l')+length('lower_leg_l','ankle_l'))/((sr[1]-sr[4]).length+(sr[4]-sr[7]).length)
assert scale>0
K=d['camera_K']; fx=K[0][0]; fy=K[1][1]
assert abs(fx-fy)<1e-5 and abs(K[0][2]-480)<1e-5 and abs(K[1][2]-260)<1e-5
for o in list(bpy.data.objects):
    if o.type in ['CAMERA','LIGHT']:bpy.data.objects.remove(o,do_unlink=True)
cam=bpy.data.objects.new('NativeDiagnosticCamera',bpy.data.cameras.new('NativeDiagnosticCamera'));scene.collection.objects.link(cam)
cam.location=(0,0,0);cam.rotation_euler=Vector((0,-1,0)).to_track_quat('-Z','Y').to_euler()
# Override roll: camera right +X, camera up -Z, camera look -Y.
cam.rotation_euler=Matrix(((1,0,0),(0,0,1),(0,-1,0))).to_euler()
cam.data.type='PERSP';cam.data.sensor_fit='HORIZONTAL';cam.data.sensor_width=36;cam.data.lens=fx*36/960
cam.data.clip_start=.01;cam.data.clip_end=1000;scene.camera=cam
scene.render.resolution_x=960;scene.render.resolution_y=520;scene.render.resolution_percentage=100
scene.render.fps=30;scene.frame_start=1;scene.frame_end=N
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE'
scene.display.shading.single_color=(.75,.75,.75);scene.display.shading.show_shadows=True
scene.world.color=(.04,.04,.04);scene.render.image_settings.file_format='PNG'
jointmap={s+'_'+part:bn+'_'+suffix for s,suffix in [('left','l'),('right','r')]
          for part,bn in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle'),('shoulder','upper_arm'),('elbow','lower_arm'),('wrist','wrist')]}
chains=[('upper_leg_l',1,4),('lower_leg_l',4,7),('upper_leg_r',2,5),('lower_leg_r',5,8),
        ('upper_arm_l',16,18),('lower_arm_l',18,20),('upper_arm_r',17,19),('lower_arm_r',19,21)]
def swing(n,target):
    b=arm.pose.bones[n];basis=(arm.matrix_world@b.matrix).to_quaternion()
    direction=(arm.matrix_world.to_3x3()@(b.tail-b.head)).normalized()
    delta=direction.rotation_difference(target.normalized())
    b.rotation_quaternion=b.rotation_quaternion@(basis.inverted()@delta@basis);update()
rest_corrections={}
for n,j,k in chains:
    target=arm.data.bones[n].tail_local-arm.data.bones[n].head_local
    source=C@(sr[k]-sr[j])
    rest_corrections[n]=target.rotation_difference(source).to_matrix()
results={}; checks=[]
for case in ['direction','rotation','rotation-limb-rest']:
    arm.animation_data_clear();previous={}; frames=[]; expected={}
    for i in range(N):
        scene.frame_set(i+1);arm.location=(0,0,0)
        for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0)
        update()
        if case in ['rotation','rotation-limb-rest']:
            local=[aa(p['global_orient'][i])]+[aa(v) for v in [p['body_pose'][i][j:j+3] for j in range(0,63,3)]]
            globalrot=[]
            for j,r in enumerate(local):globalrot.append(globalrot[parents[j]]@r if parents[j]>=0 else r)
            for n in sorted(bind,key=lambda n:len(arm.data.bones[n].parent_recursive)):
                b=arm.pose.bones[n]
                correction=rest_corrections.get(n,Matrix.Identity(3)) if case=='rotation-limb-rest' else Matrix.Identity(3)
                desired=C@globalrot[bind[n]]@C.transposed()@correction@rest[n].to_3x3()
                parent=b.parent
                parentpose=parent.matrix.to_3x3() if parent else Matrix.Identity(3)
                parentrest=rest[parent.name].to_3x3() if parent else Matrix.Identity(3)
                relative=parentrest.inverted()@rest[n].to_3x3()
                b.rotation_quaternion=(relative.inverted()@parentpose.inverted()@desired).to_quaternion();update()
                checks.append(max(abs(v) for row in (b.matrix.to_3x3()-desired) for v in row))
        else:
            b=arm.pose.bones['pelvis']; axis=rest['upper_leg_l'].translation-rest['upper_leg_r'].translation
            delta=axis.rotation_difference(src(i,1)-src(i,2));r=rest['pelvis'].to_quaternion()
            b.rotation_quaternion=r.inverted()@delta@r;update()
            for n,j,k in [('spine_lower',0,3),('spine_mid',3,6),('spine_chest',6,9)]+chains:swing(n,src(i,k)-src(i,j))
        arm.location+=src(i,0)*scale-pos('pelvis');update()
        for b in arm.pose.bones:
            q=b.rotation_quaternion
            if b.name in previous and q.dot(previous[b.name])<0:q.negate()
            previous[b.name]=q.copy();b.keyframe_insert('rotation_quaternion',frame=i+1)
        arm.keyframe_insert('location',frame=i+1)
        xy={}
        for n,bn in jointmap.items():
            v=world_to_camera_view(scene,cam,pos(bn));xy[n]=[960*v.x,520*(1-v.y)]
        frames.append({'model_frame':i,'source_frame':d['frame_map']['frames'][i]['source_frame'],'projected':xy})
        expected[i]=[list(pos(n)) for n in jointmap.values()]
    # Replay every keyed pose before saving.
    gap=0
    for i in range(N):
        scene.frame_set(i+1);update()
        gap=max(gap,max((pos(n)-Vector(v)).length for n,v in zip(jointmap.values(),expected[i])))
    assert gap<1e-4,gap
    errors=[];byframe=[]
    for f in d['review']['frames']:
        candidates=[r for r in d['frame_map']['frames'] if r['source_frame']==f['source_frame']]
        if not candidates or f['status']!='reviewed' or f['identity']=='absent':continue
        i=min(candidates,key=lambda r:abs(r['timing_error_s']))['model_frame'];e=[]
        for n,v in f['joints'].items():
            if n not in jointmap or not v.get('confirmed') or v['visibility']!='visible' or v['semantic']!='joint':continue
            err=(Vector(frames[i]['projected'][n])-Vector(v['xy_px'])).length;e.append(err);errors.append(err)
        byframe.append({'source_frame':f['source_frame'],'count':len(e),'rmse_px':math.sqrt(sum(v*v for v in e)/len(e)) if e else None})
    results[case]={'frames':frames,'review_count':len(errors),'review_rmse_px':math.sqrt(sum(v*v for v in errors)/len(errors)),
                   'review_max_px':max(errors),'by_frame':byframe,'replay_max_units':gap}
    scene.frame_set(15);bpy.ops.wm.save_as_mainfile(filepath=str(O/f'{case}-candidate.blend'))
    for sf in [49,51,53,58]:
        candidates=[r for r in d['frame_map']['frames'] if r['source_frame']==sf]
        i=min(candidates,key=lambda r:abs(r['timing_error_s']))['model_frame']
        scene.frame_set(i+1);scene.render.filepath=str(O/f'{case}-{sf:03}.png');bpy.ops.render.render(write_still=True)
results['rig_scale']=scale;results['orientation_matrix_max_error']=max(checks);results['coordinate_matrix_det']=C.determinant()
results['limits']=['No anatomical joint-limit, contact or lighting acceptance.','Static/default-K camera diagnostic only.',
                   'Normal rig proportions differ from cartoon and native SMPL-X.','Rest pose correspondence assumes matched T poses; needs anatomical review.']
(O/'retarget-score.json').write_text(json.dumps(results,indent=2)+'\n')
print('RETARGET_COMPLETE',[(k,results[k]['review_rmse_px']) for k in ['direction','rotation','rotation-limb-rest']],flush=True)
