"""Noiseless pinhole counterexample to treating normalized image XYZ as camera XYZ.

Synthetic z is exact relative camera depth scaled by f/(W*Zref). This is an
explicit hypothetical favorable encoding, NOT a claim about MediaPipe internals.
"""
import argparse,json,math
from pathlib import Path
W,H=1394,792
F=1200.
CX,CY=W/2,H/2
def sub(a,b):return [x-y for x,y in zip(a,b)]
def norm(a):return math.sqrt(sum(x*x for x in a))
def angle(a,b):
 c=sum(x*y for x,y in zip(a,b))/(norm(a)*norm(b));return math.degrees(math.acos(max(-1,min(1,c))))
def project(p):return [(F*p[0]/p[2]+CX)/W,(F*p[1]/p[2]+CY)/H]
def encode(p,zref):return project(p)+[(p[2]-zref)*F/(W*zref)]
def decode(q,zref):
 z=zref+q[2]*W*zref/F;return [(q[0]*W-CX)*z/F,(q[1]*H-CY)*z/F,z]
rows=[]
for zref in (3.,5.,8.):
 for xoffset in (-1.,0.,1.):
  for yaw in (0.,30.,60.,80.):
   theta=math.radians(yaw);v=[.4*math.cos(theta),.1,.4*math.sin(theta)];a=[xoffset,.4,zref];b=[a[i]+v[i] for i in range(3)];qa,qb=encode(a,zref),encode(b,zref);direct=sub(qb,qa);scaled=[direct[0],direct[1]*H/W,direct[2]];restored=sub(decode(qb,zref),decode(qa,zref));error=norm(sub(restored,v));assert error<1e-12
   rows.append({'center_depth':zref,'lateral_offset':xoffset,'yaw_deg':yaw,'true_direction':v,'raw_normalized_direction_error_deg':angle(direct,v),'y_scaled_direction_error_deg':angle(scaled,v),'exact_unprojection_direction_error_deg':angle(restored,v),'exact_xyz_error':error})
# Rigid rotation preserves pairwise angles: no single axis rotation repairs these distortions.
def discrepancy(zref):
 p=[1.,.4,zref];a=[p[0]+.4,p[1]+.1,p[2]];b=[p[0],p[1]+.1,p[2]+.4]
 def proxy(q):
  d=sub(encode(q,zref),encode(p,zref));return [d[0],d[1]*H/W,d[2]]
 return {'true_angle_deg':angle(sub(a,p),sub(b,p)),'proxy_angle_deg':angle(proxy(a),proxy(b))}
# Hip-relative depth has no absolute translation information by definition.
z_relative=[-.1,.1];root_examples=[{'absolute_camera_root_z':t,'relative_z':z_relative,'builder_mean_z_root_heuristic':-sum(z_relative)/2*1.5} for t in (3.,5.,8.)]
# Local pose identity must include rest orientation: Pchild=Pparent*Rrest*B.
# Known Z-axis rotations commute, sufficient to disprove omission of Rrest.
rest_deg,parent_deg,target_deg=35.,20.,80.
correct_basis_deg=target_deg-parent_deg-rest_deg
wrong_basis_deg=target_deg-parent_deg
result={'schema':'recreation2-mapping-contract-synthetic.v1','assumptions':['Known pinhole intrinsics, no distortion/no observation noise','Exact relative depth supplied with declared local X-compatible scale; not actual MediaPipe behavior','No real-video causal attribution or calibrated source camera'], 'intrinsics':{'width':W,'height':H,'fx':F,'fy':F,'cx':CX,'cy':CY},'rows':rows,'non_rotation_counterexample':discrepancy(5.),'hip_relative_root_examples':root_examples,'rest_rotation_example':{'rest_deg':rest_deg,'parent_deg':parent_deg,'target_deg':target_deg,'correct_local_basis_deg':correct_basis_deg,'omitting_rest_local_deg':wrong_basis_deg,'recovered_correct_world_deg':parent_deg+rest_deg+correct_basis_deg,'recovered_wrong_world_deg':parent_deg+rest_deg+wrong_basis_deg}}
assert abs(result['non_rotation_counterexample']['proxy_angle_deg']-result['non_rotation_counterexample']['true_angle_deg'])>1
p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=True);(out/'synthetic-report.json').write_text(json.dumps(result,indent=2)+'\n')
print('SYNTHETIC_MAPPING_PASS: 36 exact unprojections; image XYZ distortion is not a fixed rotation; root depth is unidentifiable from relative Z')
for yaw in (0.,30.,60.,80.):print(yaw,[(r['lateral_offset'],round(r['y_scaled_direction_error_deg'],3)) for r in rows if r['center_depth']==5 and r['yaw_deg']==yaw])
print('nonrotation',result['non_rotation_counterexample'])
