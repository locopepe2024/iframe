"""Existing target projections: frozen first-frame scale vs per-frame oracle."""
import json
from pathlib import Path
import numpy as np
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES,EVENTS
from recreation2_frame_occupancy import fit_2d

OUT=ROOT/'docs/agents/raw/2026-10-22-pose-focal-sensitivity'

def main():
    trackpath=Path('/private/tmp/cozyclay-media-real-20261019/track-2s.json')
    sources={r['source_frame']:r for r in json.loads(trackpath.read_text())['frames']}
    cases=[('fixed_temporal',ROOT/'docs/agents/raw/2026-10-20-fixed-length-temporal/report.json','fixed_temporal'),
           ('torso_extended',ROOT/'docs/agents/raw/2026-10-21-torso-endpoint/report.json','absolute_shoulder_extended')]
    report={'schema':'recreation2-target-occupancy.v1','image_size_px':[640,360],
            'track_sha256':base.digest(trackpath),'tool_sha256':base.digest(__file__),
            'dependencies_sha256':{'recreation2_frame_occupancy.py':base.digest(Path(__file__).with_name('recreation2_frame_occupancy.py'))},
            'cases':{},'limits':['existing 12 body joint projections only; no mesh top/sole occupancy',
                 'two candidates have different pose settings; not a paired causal treatment',
                 'first-frame/global 2D transform is a diagnostic, not a physical camera/rig calibration',
                 'per-frame oracle fit uses current source observations; not a temporal prediction or independent truth',
                 'no new bundle/render, no contact or H3 validation']}
    for name,path,key in cases:
        old=json.loads(path.read_text());assert old['sha256']['track']==base.digest(trackpath)
        case=old['cases'][key];rows=[];record=[];frozen=None
        outputs={r['output_frame']:r for r in case['output']}
        for row in case['source_observations']:
            assert row.get('kind')!='hold_until_next_pts'
            source=sources[row['source_frame']];proj=outputs[row['new_bundle_frame']]['pixels']
            names=list(proj);pred=np.array([proj[n] for n in names]);obs=np.array([source['semantic_joints'][n][:2] for n in names])*[640,360]
            assert all(abs(np.linalg.norm(pred[i]-obs[i])-row['per_joint_px'][n])<1e-6 for i,n in enumerate(names))
            fitids=[i for i,n in enumerate(names) if n in FIT_NAMES];held=[i for i,n in enumerate(names) if n not in FIT_NAMES]
            assert len(fitids)==8 and len(held)==4
            current=fit_2d(pred[fitids],obs[fitids],np.ones(8),True)
            if frozen is None:
                assert row['source_frame']==1
                frozen=current
            result={'source_frame':row['source_frame'],'source_pts_s':row['source_pts_s'],
                'source_joint_height_fraction':float(np.ptp(obs[:,1])/360),
                'target_joint_height_fraction':float(np.ptp(pred[:,1])/360),
                'height_ratio':float(np.ptp(pred[:,1])/np.ptp(obs[:,1])),
                'width_ratio':float(np.ptp(pred[:,0])/np.ptp(obs[:,0])),'corrections':{}}
            for label,(s,t) in [('baseline',(1.,np.zeros(2))),('frozen_first_frame',frozen),('per_frame_oracle',current)]:
                residual=s*pred+t-obs
                result['corrections'][label]={'scale':s,'translation_px':t.tolist(),
                    'all_mean_px':float(np.linalg.norm(residual,axis=1).mean()),
                    'distal_rmse_px':float(np.sqrt(np.mean(np.sum(residual[held]**2,axis=1)))),
                    'fit_rmse_px':float(np.sqrt(np.mean(np.sum(residual[fitids]**2,axis=1))))}
                record.append((label,residual[held]))
            rows.append(result)
        summary={label:{'distal_rmse_px':float(np.sqrt(np.mean(np.sum(np.concatenate([r for k,r in record if k==label])**2,axis=1)))),
                        'median_frame_all_mean_px':float(np.median([r['corrections'][label]['all_mean_px'] for r in rows]))}
                 for label in ['baseline','frozen_first_frame','per_frame_oracle']}
        summary['median_height_ratio']=float(np.median([r['height_ratio'] for r in rows]))
        summary['median_width_ratio']=float(np.median([r['width_ratio'] for r in rows]))
        summary['first_frame_scale']=float(frozen[0])
        report['cases'][name]={'input_report_sha256':base.digest(path),'input_report':str(path.relative_to(ROOT)),
                             'summary':summary,'frames':rows,'events':[r for r in rows if r['source_frame'] in EVENTS]}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'target-occupancy.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({n:d['summary'] for n,d in report['cases'].items()},indent=2))

if __name__=='__main__':main()
