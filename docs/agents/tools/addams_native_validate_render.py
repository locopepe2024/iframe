"""Independent camera check, bind-pose evidence and continuous Blender replay."""
import bpy,json,math
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
O=Path('/tmp/addams-pose/gvhmr-native-v1');d=json.loads((O/'native-layer-input.json').read_text())
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)));K=d['camera_K'];report={}
for case in ['direction','rotation','rotation-limb-rest']:
    bpy.ops.wm.open_mainfile(filepath=str(O/f'{case}-candidate.blend'))
    scene=bpy.context.scene;arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');cam=scene.camera
    gap=0
    for frame in d['native22']:
        for p in frame:
            v=world_to_camera_view(scene,cam,C@Vector(p));q=[K[0][0]*p[0]/p[2]+K[0][2],K[1][1]*p[1]/p[2]+K[1][2]]
            gap=max(gap,abs(960*v.x-q[0]),abs(520*(1-v.y)-q[1]))
    assert gap<.001,gap
    if case=='rotation':
        pairs=[('upper_leg_l',1,4),('lower_leg_l',4,7),('upper_leg_r',2,5),('lower_leg_r',5,8),
               ('upper_arm_l',16,18),('lower_arm_l',18,20),('upper_arm_r',17,19),('lower_arm_r',19,21)]
        rest=[Vector(v) for v in d['rest22']];angles={}
        for n,a,b in pairs:
            target=arm.data.bones[n].tail_local-arm.data.bones[n].head_local
            angles[n]=math.degrees(target.angle(C@(rest[b]-rest[a])))
        report['rest_direction_gap_degrees']=angles
        report['arm_world_matrix']=[list(r) for r in arm.matrix_world]
    report[case]={'camera_reprojection_max_px':gap}
    folder=O/f'{case}-frames';folder.mkdir(exist_ok=True)
    for i in range(len(d['native22'])):
        scene.frame_set(i+1);scene.render.filepath=str(folder/f'{i:03}.png');bpy.ops.render.render(write_still=True)
    # Independent side view follows pelvis only for inspection; no source-camera claim.
    for sf in [49,51,53,58]:
        candidates=[r for r in d['frame_map']['frames'] if r['source_frame']==sf]
        i=min(candidates,key=lambda r:abs(r['timing_error_s']))['model_frame'];scene.frame_set(i+1);bpy.context.view_layer.update()
        center=arm.matrix_world@arm.pose.bones['pelvis'].head
        cam.location=center+Vector((5,0,0));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
        cam.data.type='ORTHO';cam.data.ortho_scale=3.5
        scene.render.filepath=str(O/f'{case}-side-{sf:03}.png');bpy.ops.render.render(write_still=True)
(O/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('VALIDATED',json.dumps(report),flush=True)
