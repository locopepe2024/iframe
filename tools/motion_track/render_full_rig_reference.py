import argparse,json,sys,math,os
from pathlib import Path
from mathutils import Vector
import bpy

def args():
 raw=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 p=argparse.ArgumentParser(); p.add_argument('--state',required=True); p.add_argument('--source-blend',required=True); p.add_argument('--output',required=True); return p.parse_args(raw)
def mat(name,color):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); return m
def setup_scene(state,out):
 s=bpy.context.scene; s.render.engine='BLENDER_EEVEE_NEXT'; s.eevee.taa_render_samples=int(os.environ.get('DIRECTOR_EEVEE_RENDER_SAMPLES','4')); s.render.resolution_x=640; s.render.resolution_y=360; s.render.resolution_percentage=100; s.render.fps=int(round(state.get('fps',24))); s.frame_start=1; s.frame_end=max(1,int(round(state.get('duration_seconds',1)*s.render.fps))); s.render.image_settings.file_format='FFMPEG'; s.render.ffmpeg.format='MPEG4'; s.render.ffmpeg.codec='H264'; s.render.ffmpeg.constant_rate_factor='MEDIUM'; s.render.ffmpeg.ffmpeg_preset='REALTIME'; s.render.ffmpeg.audio_codec='NONE'; s.render.filepath=str(out/'full_rig_motion_reference.mp4'); s.world=bpy.data.worlds.new('world') if not s.world else s.world; s.world.use_nodes=True; s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.012,.018,.04,1); s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=0.9
 for name,loc,energy,color in [('key',(-4,-4,7),5000,(.8,.9,1)),('fill',(4,-1,5),3500,(1,.7,.8)),('rim',(0,5,6),4500,(.8,.75,1))]:
  d=bpy.data.lights.new(name,'POINT'); d.energy=energy; d.color=color; o=bpy.data.objects.new(name,d); bpy.context.collection.objects.link(o); o.location=loc
 # floor
 d=bpy.data.materials.new('floor'); d.diffuse_color=(.045,.055,.085,1); bpy.ops.mesh.primitive_cube_add(location=(0,0,-.1),scale=(5,4,.1)); bpy.context.object.data.materials.append(d)
 # camera
 cd=bpy.data.cameras.new('camera-main-data'); cam=bpy.data.objects.new('camera-main',cd); bpy.context.collection.objects.link(cam); s.camera=cam; cd.lens=36/(2*math.tan(math.radians(50)/2)); cam.location=(0,-9.5,4.8); target=bpy.data.objects.new('camera-look-at',None); bpy.context.collection.objects.link(target); target.location=(0,0,1.25); c=cam.constraints.new('TRACK_TO'); c.target=target; c.track_axis='TRACK_NEGATIVE_Z'; c.up_axis='UP_Y'
def duplicate_actor(source_arm,source_meshes,actor,frame_end):
 root=bpy.data.objects.new(actor['actor_id']+'-root',None); bpy.context.collection.objects.link(root); root.location=actor.get('placement',{}).get('position',[0,0,0]);
 arm=source_arm.copy(); arm.data=source_arm.data.copy(); arm.name=actor['actor_id']+'-armature'; arm.hide_render=False; arm.hide_viewport=False; bpy.context.collection.objects.link(arm); arm.parent=root; arm.location=(0,0,0); arm.animation_data_clear()
 meshes=[]
 for src in source_meshes:
  m=src.copy(); m.data=src.data.copy(); m.name=actor['actor_id']+'-'+src.name; m.hide_render=False; m.hide_viewport=False; bpy.context.collection.objects.link(m); m.parent=arm; m.matrix_parent_inverse=arm.matrix_world.inverted();
  for mod in m.modifiers:
   if mod.type=='ARMATURE': mod.object=arm
  meshes.append(m)
 tracks=actor.get('motion_track') or []
 if tracks:
  for sample in tracks:
   frame=max(1,min(frame_end,int(sample.get('frame',1))))
   root.location=Vector(sample.get('root_position',[0,0,0])); root.keyframe_insert(data_path='location',frame=frame)
   for jid,rot in (sample.get('joint_rotations_deg') or {}).items():
    pb=arm.pose.bones.get(jid)
    if not pb or not isinstance(rot,(list,tuple)) or len(rot)!=3: continue
    pb.rotation_mode='XYZ'; pb.rotation_euler=tuple(math.radians(float(v)) for v in rot); pb.keyframe_insert(data_path='rotation_euler',frame=frame)
 else:
  root.keyframe_insert(data_path='location',frame=1); root.keyframe_insert(data_path='location',frame=frame_end)
 for obj in [root,arm,*arm.pose.bones]:
  ad=getattr(obj,'animation_data',None)
  if ad and ad.action:
   for fc in ad.action.fcurves:
    for kp in fc.keyframe_points: kp.interpolation='BEZIER'
 return root

def main():
 a=args(); out=Path(a.output); out.mkdir(parents=True,exist_ok=True); state=json.loads(Path(a.state).read_text())
 bpy.ops.wm.open_mainfile(filepath=str(Path(a.source_blend).resolve()))
 setup_scene(state,out)
 source_arm=next(o for o in bpy.data.objects if o.type=='ARMATURE'); source_meshes=[o for o in bpy.data.objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
 for o in list(bpy.data.objects): o.hide_render=True; o.hide_viewport=True
 for i,actor in enumerate(state.get('actors',[])):
  duplicate_actor(source_arm,source_meshes,actor,bpy.context.scene.frame_end)
 for obj in bpy.data.objects:
  if obj.type != 'MESH': continue
  for material in obj.data.materials:
   if not material: continue
   material.diffuse_color=(0.82,0.87,0.92,1)
   material.use_nodes=True
   nodes=material.node_tree.nodes
   nodes.clear()
   output=nodes.new('ShaderNodeOutputMaterial')
   emission=nodes.new('ShaderNodeEmission')
   emission.inputs['Color'].default_value=(0.82,0.87,0.92,1)
   emission.inputs['Strength'].default_value=1.0
   material.node_tree.links.new(emission.outputs['Emission'],output.inputs['Surface'])
 bpy.context.scene.render.filepath=str(out/'full_rig_motion_reference.mp4'); bpy.ops.render.render(animation=True)
 manifest={'schema_version':'director_full_rig_manifest.v1','state_id':state.get('state_id'),'rig_asset':Path(a.source_blend).name,'rig_bones':len(source_arm.data.bones),'frame_range':[1,bpy.context.scene.frame_end],'fps':bpy.context.scene.render.fps,'width':640,'height':360,'actors':[x.get('actor_id') for x in state.get('actors',[])],'output':'full_rig_motion_reference.mp4'}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)); print(json.dumps(manifest,ensure_ascii=False))
if __name__=='__main__': main()
