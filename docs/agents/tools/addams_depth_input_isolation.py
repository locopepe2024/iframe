"""Factorial 2D/3D input isolation at fixed focal length; diagnostic only."""
import hashlib
import json
import math
from pathlib import Path
from addams_perspective_probe import fit

BASE = Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package/addams-fixed-rig'


def at_depth(xy, xyz, names, z):
    scales = {n: 960/(xyz[n][2]+z) for n in xyz}
    t = [sum(scales[n]*(xy[n][k]-[480,260][k]-scales[n]*xyz[n][k]) for n in names)/sum(scales[n]**2 for n in names) for k in range(2)]
    pred = {n: [scales[n]*(xyz[n][k]+t[k])+[480,260][k] for k in range(2)] for n in xyz}
    return math.sqrt(sum(math.dist(pred[n],xy[n])**2 for n in names)/len(names))


def main():
    paths = [BASE/'distributed-score.json', BASE/'distributed-control.json']
    scores, raw = [json.loads(p.read_text()) for p in paths]
    s = {r['source_frame']:r for r in scores['rows'] if r['case']=='distributed_swing'}
    x = {r['source_frame']:r['xyz_right_down_forward'] for r in raw['rows'] if r['case']=='distributed_swing'}
    names = [n for n in s[21]['source'] if n.endswith(('hip','ankle'))]
    cases = []
    for f2 in [21,22]:
        for f3 in [21,22]:
            xy, xyz = s[f2]['source'], x[f3]
            v = fit(xy,xyz,960,names)
            low = max(.05,-min(p[2] for p in xyz.values())+.05)
            grid = [low*(100/low)**(i/10000) for i in range(10001)]
            errors = [at_depth(xy,xyz,names,z) for z in grid]
            minima = [i for i in range(1,len(grid)-1) if errors[i]<errors[i-1] and errors[i]<errors[i+1]]
            best = min(range(len(grid)),key=lambda i:errors[i])
            assert abs(errors[best]-v['fit_rmse_px'])<.001
            near = [z for z,e in zip(grid,errors) if e<=v['fit_rmse_px']+1]
            cases.append({'frame_2d':f2,'frame_3d':f3,'translation':v['translation'],'rmse_px':v['fit_rmse_px'],
                          'dense_grid_min_depth':grid[best],'dense_grid_min_rmse_px':errors[best],
                          'interior_local_minima':[{'depth':grid[i],'rmse_px':errors[i]} for i in minima],
                          'depth_range_within_1px_rmse':[min(near),max(near)],
                          'rmse_at_frame21_depth':at_depth(xy,xyz,names,s[21]['translation'][2]),
                          'profile':[{'depth':grid[i],'rmse_px':errors[i]} for i in range(0,len(grid),50)]})
    # Attribute nonlinear interaction explicitly; do not assume additive effects.
    z={(r['frame_2d'],r['frame_3d']):r['translation'][2] for r in cases}
    attribution={'total_depth_delta':z[22,22]-z[21,21],
                 'only_2d_delta':z[22,21]-z[21,21], 'only_3d_delta':z[21,22]-z[21,21],
                 'interaction_delta':z[22,22]-z[22,21]-z[21,22]+z[21,21]}
    assert abs(attribution['total_depth_delta']-sum(attribution[k] for k in ['only_2d_delta','only_3d_delta','interaction_delta']))<1e-9
    per_joint=[]
    for n in names:
        per_joint.append({'joint':n,'input_2d_delta_px':[b-a for a,b in zip(s[21]['source'][n],s[22]['source'][n])],
                          'input_3d_delta_units':[b-a for a,b in zip(x[21][n],x[22][n])]})
    cross=[]
    for frozen in names:
        xy=dict(s[22]['source']);xy[frozen]=s[21]['source'][frozen]
        v=fit(xy,x[22],960,names)
        cross.append({'frozen_2d_joint':frozen,'depth':v['translation'][2],'rmse_px':v['fit_rmse_px']})
    axes=[]
    for axis,label in enumerate(['right','down','forward']):
        xyz={n:list(v) for n,v in x[22].items()}
        for n in xyz: xyz[n][axis]=x[21][n][axis]
        v=fit(s[22]['source'],xyz,960,names)
        axes.append({'frozen_3d_axis':label,'depth':v['translation'][2],'rmse_px':v['fit_rmse_px']})
    joints=[]
    for joint in names:
        xyz=dict(x[22]);xyz[joint]=x[21][joint]
        v=fit(s[22]['source'],xyz,960,names)
        joints.append({'frozen_3d_joint':joint,'depth':v['translation'][2],'rmse_px':v['fit_rmse_px']})
    report={'focal_px':960,'fit_names':names,'input_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
            'factorial_cases':cases,'depth_delta_decomposition_units':attribution,'input_changes':per_joint,'one_joint_2d_freeze':cross,'one_axis_3d_freeze':axes,'one_joint_3d_freeze':joints,
            'limits':['Mixed-frame inputs are counterfactual diagnostics, not physically valid poses.',
                      'Dense grid covers positive depths up to100; does not establish global behavior outside domain.',
                      'Fixed focal and orientation, estimated source landmarks, hip-relative 3D; no recovered camera truth.',
                      'Within1px RMSE range is a sensitivity measure, not statistical confidence interval.',
                      'Per-joint freezing is conditional and interaction-dependent; not a causal ranking.']}
    (BASE/'depth-input-isolation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({**{k:v for k,v in report.items() if k not in ['factorial_cases','limits','input_sha256']},'cases':[{k:v for k,v in r.items() if k!='profile'} for r in cases]},indent=2))


if __name__=='__main__':
    main()
