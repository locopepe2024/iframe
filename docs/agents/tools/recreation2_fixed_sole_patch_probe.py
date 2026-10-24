"""Read-only fixed-vertex sole patch probe on the pinned Blender rig."""
import argparse, json, sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).parent))
import render_full_motion_bundle as renderer

raw = sys.argv[sys.argv.index('--') + 1:]
parser = argparse.ArgumentParser(); parser.add_argument('--rig', required=True); parser.add_argument('--bundle', required=True); parser.add_argument('--out', required=True)
A = parser.parse_args(raw)
bundle = json.loads(Path(A.bundle).read_text()); out = Path(A.out); out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=A.rig)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
root = bpy.data.objects.new('fixed-sole-probe-root', None); bpy.context.collection.objects.link(root); arm.parent = root
obj = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('-03'))

def groups_for(side):
    names = {f'DEF_foot_{side}', f'toe_{side}', f'toe_attachment_{side}'}
    return {g.index for g in obj.vertex_groups if g.name in names}

def positions():
    deps = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(deps); mesh = ev.to_mesh()
    result = [ev.matrix_world @ v.co for v in mesh.vertices]; ev.to_mesh_clear(); return result

def candidates(side, threshold=.20):
    groups = groups_for(side); vals=[]
    for v in obj.data.vertices:
        weight = max((g.weight for g in v.groups if g.group in groups), default=0)
        if weight >= threshold: vals.append((v.index, weight))
    return vals

for b in arm.pose.bones: b.rotation_mode='QUATERNION'; b.rotation_quaternion=(1,0,0,0)
bpy.context.view_layer.update()
rest_positions = positions(); patches={}
for side in ('l','r'):
    vals=candidates(side); zmin=min(rest_positions[i].z for i,_ in vals); zmax=max(rest_positions[i].z for i,_ in vals)
    band=max(.008,(zmax-zmin)*.05); patches[side]=[i for i,_ in vals if rest_positions[i].z <= zmin+band]

def summarize(side, ps):
    pts=[ps[i] for i in patches[side]]; c=sum(pts, Vector())/len(pts)
    return {'count':len(pts),'min_z':min(point.z for point in pts),'max_z':max(point.z for point in pts),'centroid_world':list(c),'bounds':[[min(point[i] for point in pts) for i in range(3)],[max(point[i] for point in pts) for i in range(3)]]}

frames={}
for fd in bundle['frames']:
    renderer.apply_bundle({'frames':[fd], 'fps':bundle['fps'], 'frame_range':[fd['frame'],fd['frame']], 'facing_offset_deg':bundle.get('facing_offset_deg',0)}, arm)
    bpy.context.scene.frame_set(int(fd['frame'])); bpy.context.view_layer.update(); ps=positions()
    frames[str(fd['frame'])]={s:summarize(s,ps) for s in ('l','r')}
report={'schema':'recreation2-fixed-sole-patch-probe.v1','rig':A.rig,'bundle':A.bundle,'mesh':obj.name,'groups':{s:[g.name for g in obj.vertex_groups if g.index in groups_for(s)] for s in ('l','r')},'patches':patches,'frames':frames}
out.write_text(json.dumps(report,indent=2)+'\n'); print(out)
