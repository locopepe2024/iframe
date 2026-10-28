import bpy,json,hashlib
from pathlib import Path
p=Path('/tmp/addams-pose/fixed-rig-diagnostic.blend')
bpy.ops.wm.open_mainfile(filepath=str(p));a=next(o for o in bpy.data.objects if o.type=='ARMATURE');out=[]
for f in range(6,25):
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update();j={}
 for side,s in [('left','l'),('right','r')]:
  for part,b in [('hip','upper_leg'),('knee','lower_leg'),('ankle','ankle')]:
   q=a.matrix_world@a.pose.bones[b+'_'+s].head;j[side+'_'+part]=[q.x,-q.z,q.y]
 c=[(j['left_hip'][k]+j['right_hip'][k])/2 for k in range(3)]
 out.append({'source_frame':f,'xyz_right_down_forward':{key:[v[k]-c[k] for k in range(3)] for key,v in j.items()}})
Path('/tmp/addams-pose/camera-points.json').write_text(json.dumps({'blend_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rows':out},indent=2))
