"""Render a grayscale Z-depth reference sequence from a motion bundle."""
import argparse,json,os,sys
from pathlib import Path
import bpy
from mathutils import Quaternion,Vector

def args():
 raw=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 p=argparse.ArgumentParser();p.add_argument('--bundle',required=True);p.add_argument('--source-blend',required=True);p.add_argument('--output',required=True);return p.parse_args(raw)
def apply(bundle,arm):
 for f in bundle['frames']:
  frame=int(f['frame']); quats=dict(f.get('localQuaternions') or {}); 
  if f.get('pelvisQuaternion'):quats['pelvis']=f['pelvisQuaternion']
  for n,v in quats.items():
   b=arm.pose.bones.get(n)
   if b and isinstance(v,list) and len(v)==4:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion((v[3],v[0],v[1],v[2]));b.keyframe_insert(data_path='rotation_quaternion',frame=frame)
  if arm.parent and f.get('rootPosition') is not None:arm.parent.location=Vector(f['rootPosition']);arm.parent.keyframe_insert(data_path='location',frame=frame)
def main():
 a=args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True);b=json.loads(Path(a.bundle).read_text());bpy.ops.wm.open_mainfile(filepath=str(Path(a.source_blend).resolve()));arm=[o for o in bpy.data.objects if o.type=='ARMATURE'][0];root=bpy.data.objects.new('depth-motion-root',None);bpy.context.collection.objects.link(root);arm.parent=root;apply(b,arm)
 s=bpy.context.scene;s.render.engine='BLENDER_EEVEE_NEXT';s.eevee.taa_render_samples=1;s.render.resolution_x=640;s.render.resolution_y=360;s.render.resolution_percentage=100;s.render.fps=int(b['fps']);s.frame_start=int(b['frame_range'][0]);s.frame_end=int(b['frame_range'][1]);s.render.image_settings.file_format='PNG';s.view_layers[0].use_pass_z=True
 cam_data=bpy.data.cameras.new('depth-camera-data');cam=bpy.data.objects.new('depth-camera',cam_data);bpy.context.collection.objects.link(cam);cam.location=(0,-5.2,2.6);cam_data.lens=55;target=bpy.data.objects.new('depth-target',None);bpy.context.collection.objects.link(target);target.location=(0,0,1.0);con=cam.constraints.new('TRACK_TO');con.target=target;con.track_axis='TRACK_NEGATIVE_Z';con.up_axis='UP_Y';s.camera=cam
 s.use_nodes=True;n=s.node_tree.nodes;n.clear();links=s.node_tree.links;rl=n.new('CompositorNodeRLayers');norm=n.new('CompositorNodeNormalize');comp=n.new('CompositorNodeComposite');links.new(rl.outputs['Depth'],norm.inputs['Value']);links.new(norm.outputs['Value'],comp.inputs['Image']);s.render.filepath=str(out/'depth-');bpy.ops.render.render(animation=True)
 print(json.dumps({'status':'completed','frames':s.frame_end-s.frame_start+1,'pattern':'depth-####.png'}))
if __name__=='__main__':main()
