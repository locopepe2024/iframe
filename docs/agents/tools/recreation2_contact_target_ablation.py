"""Media-only diagnostic; reuse the previously checked analytic IK functions."""
import argparse
import copy
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Quaternion, Vector
sys.path.insert(0, str(Path(__file__).parent))
# Load only function definitions/imports, never the older probe's entry point.
helper = Path(__file__).with_name('recreation2_two_bone_ik_probe.py')
exec(compile(helper.read_text().split('parser = argparse.ArgumentParser()')[0], str(helper), 'exec'), globals())
p = argparse.ArgumentParser()
for key in ('rig', 'bundle', 'track', 'anchors', 'reference', 'out'):
    p.add_argument('--'+key, required=True)
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
bundle = json.loads(Path(a.bundle).read_text())
assert hashlib.sha256(Path(a.track).read_bytes()).hexdigest() == '0fed823bf39bd206ebeafec922a29394ee87a942b1bcc0395610a603d598550a'
track = {f['source_frame']:f for f in json.loads(Path(a.track).read_text())['frames']}
anchors = {f['source_frame']:f for f in json.loads(Path(a.anchors).read_text())}
reference = json.loads(Path(a.reference).read_text())['cases']['raw_root_yaw']['summary']['selected_source_mean_px']
by_output = {f['frame']:f for f in bundle['frames']}
PARTS = {'shoulder':'upper_arm','elbow':'lower_arm','wrist':'wrist','hip':'upper_leg','knee':'lower_leg','ankle':'ankle'}
bpy.ops.wm.open_mainfile(filepath=a.rig)
arm = next(o for o in bpy.data.objects if o.type=='ARMATURE')
mesh = bpy.data.objects['white-model-neutral-female-03']
if arm.animation_data: arm.animation_data_clear()
for b in arm.pose.bones:
    assert not b.constraints
    b.rotation_mode='QUATERNION'; b.rotation_quaternion=Quaternion()
update()
ps=vertex_positions(); patches={}
for side in ('l','r'):
    groups={g.index for g in mesh.vertex_groups if g.name in {f'DEF_foot_{side}',f'toe_{side}',f'toe_attachment_{side}'}}
    ids=[v.index for v in mesh.data.vertices if max((g.weight for g in v.groups if g.group in groups),default=0)>=.2]
    zmin=min(ps[i].z for i in ids)
    patches[side]=[i for i in ids if ps[i].z<=zmin+.008]
root=bpy.data.objects.new('contact-ablation-root',None); bpy.context.collection.objects.link(root); arm.parent=root
renderer.setup_scene(bundle,out)
load_pose(by_output[1]); ground=patch_center('l').z
rows=[]
for source,side in [(1,'l'),(17,'l'),(23,'l'),(29,'l'),(41,'r'),(55,'r')]:
    fd=by_output[anchors[source]['new_bundle_frame']]
    load_pose(fd); pix=joint_pixels(); before=errors(pix,track[source]['semantic_joints'])
    assert abs(before['mean_px']-reference[str(source)])<.02,(source,before['mean_px'],reference[str(source)])
    solve(side,head('ankle_'+side).copy())
    zero=max(math.dist(v,joint_pixels()[k]) for k,v in pix.items()); assert zero<.01
    for target in ('ankle','toe','patch'):
        load_pose(fd); oldpatch=patch_center(side).copy()
        anchor=oldpatch if target=='patch' else head(target+'_'+side).copy()
        requested=ground-anchor.z; dz=max(-.04,min(.04,requested))
        geometry=solve(side,head('ankle_'+side)+Vector((0,0,dz)))
        newpatch=patch_center(side).copy(); afterpix=joint_pixels()
        unchanged=[k for k in pix if not k.startswith('left_' if side=='l' else 'right_') or k.split('_',1)[1] in ('hip','shoulder','elbow','wrist')]
        stable=max(math.dist(pix[k],afterpix[k]) for k in unchanged); assert stable<.01
        baked=copy.deepcopy(fd)
        for name in ('upper_leg_'+side,'lower_leg_'+side,'ankle_'+side,'foot_'+side):
            q=arm.pose.bones[name].rotation_quaternion; baked['localQuaternions'][name]=[q.x,q.y,q.z,q.w]
        load_pose(baked); rt=max(math.dist(v,joint_pixels()[k]) for k,v in afterpix.items()); assert rt<.01
        rows.append(dict(source_frame=source,source_pts_s=anchors[source]['source_pts_s'],side=side,target=target,before=before,after=errors(afterpix,track[source]['semantic_joints']),requested_dz=requested,applied_dz=dz,cap_hit=abs(requested)>.04,patch_before=list(oldpatch),patch_after=list(newpatch),patch_plane_residual_before=oldpatch.z-ground,patch_plane_residual_after=newpatch.z-ground,patch_horizontal_displacement=math.hypot(newpatch.x-oldpatch.x,newpatch.y-oldpatch.y),zero_max_px=zero,unchanged_max_px=stable,roundtrip_max_px=rt,geometry=geometry))
report=dict(schema='recreation2-contact-target-ablation.v1',blender=bpy.app.version_string,rig_sha256=hashlib.sha256(Path(a.rig).read_bytes()).hexdigest(),ground_proxy=ground,patches=patches,rows=rows,limits=['Synthetic plane, not recovered source floor','Ankle and toe are uncalibrated negative controls','Sparse event displacements are not continuous slip measurements','No H3 evaluation or production changes'])
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('CONTACT_TARGET_ABLATION_PASS',len(rows))
