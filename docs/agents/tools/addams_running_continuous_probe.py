"""Bake a bounded same-shot root-height hypothesis, preserving internal poses."""
import json
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BASE = Path('/tmp/addams-pose/gvhmr-native-v1')
OUT = BASE / 'running-continuous-v2'
OUT.mkdir(exist_ok=False)
contract = json.loads((BASE / 'target-rig-contract.json').read_text())
ground = json.loads((BASE / 'running-flight-v1/report.json').read_text())['diagnostic_ground_z']
bpy.ops.wm.open_mainfile(filepath=str(BASE / 'inferred-world-camera-candidate.blend'))
scene = bpy.context.scene
arm = bpy.data.objects[contract['armature']]
mesh = bpy.data.objects[contract['mesh']]
scene.render.resolution_x = 960
scene.render.resolution_y = 520
scene.render.resolution_percentage = 100
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.image_settings.file_format = 'PNG'


def update():
    bpy.context.view_layer.update()


def heads():
    return {b.name: arm.matrix_world @ b.head for b in arm.pose.bones}


def soles():
    obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return {s: min((obj.matrix_world @ obj.data.vertices[i].co).z for i in contract['feet'][s]['cluster_vertex_indices']) - ground for s in ['l', 'r']}


def pixels(points):
    return {n: Vector((q.x*960, (1-q.y)*520)) for n,v in points.items()
            for q in [world_to_camera_view(scene,scene.camera,v)]}


samples = []
for sf in range(58,66):
    bf = 1 + (sf-37)*30/25
    scene.frame_set(int(bf), subframe=bf-int(bf))
    update()
    samples.append({'source_frame': sf, 'source_pts_s': (sf-1)/25,
                    'location': arm.location.copy(), 'rotation': arm.rotation_quaternion.copy(),
                    'scale': arm.scale.copy(), 'matrix': arm.matrix_world.copy(),
                    'bones': {b.name: b.matrix_basis.copy() for b in arm.pose.bones},
                    'heads': heads(), 'soles': soles()})

# Source-pose animation is sampled before clearing to prevent feedback.
arm.animation_data_clear()
scene.render.fps = 25
scene.frame_start = 1
scene.frame_end = len(samples)

def correction(sf, knots):
    if sf <= knots[0][0]:
        return knots[0][1]
    for (a,ya),(b,yb) in zip(knots,knots[1:]):
        if sf <= b:
            t=(sf-a)/(b-a)
            return ya+(yb-ya)*t*t*(3-2*t)
    return knots[-1][1]

reports = []
for mode, clearance in [('baseline',None),('flight-5mm',.005),('flight-1cm',.01)]:
    arm.animation_data_clear()
    by_sf = {r['source_frame']:r for r in samples}
    knots = [(58,-by_sf[58]['soles']['l']), (62,-by_sf[62]['soles']['l']),
             (64,clearance-min(by_sf[64]['soles'].values()))] if clearance is not None else [(58,0),(64,0)]
    rows = []
    folder = OUT / mode
    folder.mkdir()
    for index,r in enumerate(samples,1):
        scene.frame_set(index)
        arm.matrix_world = r['matrix'].copy()
        for b in arm.pose.bones:
            b.matrix_basis = r['bones'][b.name]
        dz = correction(r['source_frame'],knots)
        # Geometric nonpenetration is not a semantic contact or foot lock.
        if clearance is not None:
            dz = max(dz, -min(r['soles'].values()))
        mat = arm.matrix_world.copy()
        mat.translation.z += dz
        arm.matrix_world = mat
        update()
        after = heads()
        before_px,after_px = pixels(r['heads']),pixels(after)
        relative_error = max(((after[n]-after['pelvis'])-(v-r['heads']['pelvis'])).length for n,v in r['heads'].items())
        rows.append({'source_frame':r['source_frame'], 'source_pts_s':r['source_pts_s'],
                     'root_delta_z_m':dz, 'sole_height_m':soles(),
                     'pelvis':list(after['pelvis']), 'relative_joint_max_change_m':relative_error,
                     'max_projection_shift_px':max((after_px[n]-before_px[n]).length for n in after)})
        for key in ['location','rotation_quaternion','scale']:
            arm.keyframe_insert(key,frame=index)
        for b in arm.pose.bones:
            for key in ['location','rotation_quaternion','scale']:
                b.keyframe_insert(key,frame=index)
        if mode != 'flight-5mm':
            scene.render.filepath = str(folder / f'{index:03}.png')
            bpy.ops.render.render(write_still=True)
    # Bake original evaluated pose at exact source PTS, then verify replay.
    replay = 0
    for index,r in enumerate(samples,1):
        scene.frame_set(index)
        update()
        replay=max(replay,(heads()['pelvis']-Vector(rows[index-1]['pelvis'])).length)
    assert replay<1e-5, replay
    assert max(r['relative_joint_max_change_m'] for r in rows)<1e-5
    if clearance is not None:
        flight=next(r for r in rows if r['source_frame']==64)
        assert all(min(r['sole_height_m'].values()) >= -1e-5 for r in rows)
        assert min(flight['sole_height_m'].values())>=clearance-1e-5
        assert flight['sole_height_m']['r']>flight['sole_height_m']['l']
    dz=[r['root_delta_z_m'] for r in rows]
    vel=[(b-a)*25 for a,b in zip(dz,dz[1:])]
    acc=[(b-a)*25 for a,b in zip(vel,vel[1:])]
    reports.append({'mode':mode,'knots':knots,'rows':rows,'replay_pelvis_max_m':replay,
                    'max_correction_velocity_m_s':max(map(abs,vel)),
                    'max_correction_acceleration_m_s2':max(map(abs,acc))})
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(mode+'.blend')))
report={'schema':'addams-running-continuous-root.v2','source_range':[58,65],
        'source_fps':25,'ground_z':ground,'cases':reports,'production_eligible':False,
        'limits':['Clearance and correction interpolation are hypotheses; no metric source height.',
                  'No landing endpoint before shot cut66; base correction held64 to65, clipped by nonpenetration.',
                  'Only root height corrected; source-pose/ground/camera errors remain.',
                  'Eight source frames are only0.32s; no full-motion quality claim.',
                  'Correction derivatives do not establish smoothness of original full-body animation.']}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('CONTINUOUS_COMPLETE',[(r['mode'],r['replay_pelvis_max_m']) for r in reports],flush=True)
