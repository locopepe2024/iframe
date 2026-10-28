"""Track fixed foot-mesh vertex IDs and render diagnostic views, no contact fit."""
import json,math,hashlib
from pathlib import Path
import bpy
from mathutils import Vector
BASE=Path('/tmp/addams-annotation-check');OUT=BASE/'sole-review-v1';OUT.mkdir(exist_ok=True)
FILE=BASE/'blender-roundtrip-v2/reviewed-leg-candidates.blend'
bpy.ops.wm.open_mainfile(filepath=str(FILE));arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh=bpy.data.objects['white-model-neutral-female-03'];inspection=json.loads((OUT/'mesh-inspection.json').read_text())['meshes'][0]
verts=inspection['foot_vertices'];zmin=min(v['rest_world'][2] for v in verts);zmax=max(v['rest_world'][2] for v in verts)
band=max(.002,(zmax-zmin)*.1);sole=[v for v in verts if v['rest_world'][2]<=zmin+band];assert len(sole)>=3
# Preserve original vertex IDs by evaluating armature deformation alone.
disabled=[]
for m in mesh.modifiers:
 if m.type!='ARMATURE' and m.show_viewport:
  disabled.append(m.name);m.show_viewport=False;m.show_render=False
ids=[v['index'] for v in sole];rows=[]
def centroid(points):return sum(points,Vector())/len(points)
for weight in [0,1,4]:
 arm.animation_data.action=bpy.data.actions[f'reviewed_legs_temporal_{weight}']
 for sf in range(20,25):
  bpy.context.scene.frame_set(sf);bpy.context.view_layer.update();evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());geo=evaluated.to_mesh()
  assert len(geo.vertices)==inspection['vertex_count'],(len(geo.vertices),inspection['vertex_count'])
  points=[evaluated.matrix_world@geo.vertices[i].co for i in ids];ankle=arm.matrix_world@arm.pose.bones['ankle_r'].head
  rows.append({'weight':weight,'source_frame':sf,'sole_centroid_camera_world':list(centroid(points)),
               'ankle_camera_world':list(ankle),'sole_centroid_minus_ankle':list(centroid(points)-ankle),
               'sole_min_z_camera_world':min(p.z for p in points),'sole_max_z_camera_world':max(p.z for p in points),
               'sole_points_camera_world':[list(p) for p in points]});evaluated.to_mesh_clear()
summary=[]
for weight in [0,1,4]:
 pts=[Vector(r['sole_centroid_camera_world']) for r in rows if r['weight']==weight]
 summary.append({'weight':weight,'sole_centroid_vertical_range_units':max(p.z for p in pts)-min(p.z for p in pts),
                 'max_centroid_step_units':max((a-b).length for a,b in zip(pts,pts[1:]))})
report={'input_blend_sha256':hashlib.sha256(FILE.read_bytes()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'mesh':mesh.name,'foot_influence_threshold':.5,'rest_bottom_band_units':band,'rest_foot_z_range':[zmin,zmax],
        'sole_vertex_ids':ids,'sole_vertex_count':len(ids),'disabled_modifiers':disabled,'summary':summary,'rows':rows,
        'limits':['Bottom10percent of rest foot height is a geometric candidate, not manually validated sole.','Pinned neutral female foot, not source character shoe geometry.',
                  'Coordinate vertical is camera-relative diagnostic Z, not calibrated gravity.','No ground, IK, recovered ankle orientation or world root; no physical slip claim.']}
(OUT/'sole-track.json').write_text(json.dumps(report,indent=2)+'\n')
# White material and neutral lighting for geometry review; no ground plane to imply calibration.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8
scene.render.resolution_x=480;scene.render.resolution_y=260;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25);scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
material=bpy.data.materials.new('DiagnosticWhite');material.diffuse_color=(.65,.65,.65,1);material.use_nodes=True
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.65,.65,.65,1)
material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8
for o in bpy.data.objects:
 if o.type=='MESH':
  o.data.materials.clear();o.data.materials.append(material)
light=bpy.data.objects.new('DiagnosticArea',bpy.data.lights.new('DiagnosticArea','AREA'));scene.collection.objects.link(light);light.location=(1,-2,3);light.data.energy=400;light.data.shape='DISK';light.data.size=5
light.rotation_euler=(Vector((0,4,0))-light.location).to_track_quat('-Z','Y').to_euler()
cam=scene.camera;arm.animation_data.action=bpy.data.actions['reviewed_legs_temporal_1']
for sf in [20,21,22,23,24]:
 scene.frame_set(sf);scene.render.filepath=str(OUT/f'source-view-{sf:03}.png');bpy.ops.render.render(write_still=True)
# Side view uses same frozen geometry with changed diagnostic camera only.
scene.frame_set(24);bpy.context.view_layer.update();center=(arm.matrix_world@arm.pose.bones['pelvis'].head);cam.data.type='ORTHO';cam.data.ortho_scale=4.8
cam.location=center+Vector((4,0,0));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(OUT/'side-view-024.png');bpy.ops.render.render(write_still=True)
# Magnified geometric proxy review in the foot's current pose.
record=next(r for r in rows if r['weight']==1 and r['source_frame']==24);footcenter=Vector(record['sole_centroid_camera_world'])
marker_material=bpy.data.materials.new('SoleProxyMagenta');marker_material.diffuse_color=(1,.03,.35,1)
for p in record['sole_points_camera_world']:
 bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.003,location=p);bpy.context.object.data.materials.append(marker_material)
cam.location=footcenter+Vector((.6,-.6,.15));cam.rotation_euler=(footcenter-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=.6;scene.render.filepath=str(OUT/'sole-proxy-024.png');bpy.ops.render.render(write_still=True)
print('SOLE_RENDER_COMPLETE',len(ids),summary)
