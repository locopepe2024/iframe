"""Score frozen/pelvis variants with identical conditional perspective fits."""
import json,statistics,math
from pathlib import Path
from addams_perspective_probe import fit
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/addams-fixed-rig'
def main():
 data=json.loads((OUT/'pelvis-control.json').read_text());old=json.loads((OUT/'fixed-rig-report.json').read_text());points=json.loads((OUT/'camera-points.json').read_text());sources={r['source_frame']:{j['name']:j['source'] for j in r['joints']} for r in old['frames']};prev={r['source_frame']:r['xyz_right_down_forward'] for r in points['rows']}
 rows=[];frozen_gap=[]
 for r in data['rows']:
  xy=sources[r['source_frame']];xyz=r['xyz_right_down_forward'];names=list(xy);held=[n for n in names if n.endswith('knee')];train=[n for n in names if n not in held];a=fit(xy,xyz,960,names);b=fit(xy,xyz,960,train)
  if r['case']=='frozen':frozen_gap.extend(math.dist(xyz[n],prev[r['source_frame']][n]) for n in names)
  rows.append({'case':r['case'],'source_frame':r['source_frame'],'all6_mean_px':statistics.mean(math.dist(a['predicted'][n],xy[n]) for n in names),'held_knee_rmse_px':math.sqrt(sum(math.dist(b['predicted'][n],xy[n])**2 for n in held)/2),'all6_translation':a['translation'],'fit_bound_hit':a['depth_bound_hit'] or b['depth_bound_hit'],'hip_axis_error_deg':r['hip_axis_error_deg'],'leg_direction_error_deg':r['leg_direction_max_error_deg']})
 assert max(frozen_gap)<1e-5,max(frozen_gap)
 summary={}
 for case in ['frozen','hip_axis','hip_torso_frame']:
  v=[r for r in rows if r['case']==case];summary[case]={key:statistics.median(r[key] for r in v) for key in ['all6_mean_px','held_knee_rmse_px','hip_axis_error_deg']};summary[case]['leg_direction_max_deg']=max(r['leg_direction_error_deg'] for r in v)
 reference={r['source_frame']:r for r in rows if r['case']=='frozen'}
 for case in ['hip_axis','hip_torso_frame']:
  summary[case]['held_knee_improved_frames']=sum(r['held_knee_rmse_px']<reference[r['source_frame']]['held_knee_rmse_px'] for r in rows if r['case']==case)
 report={'focal_px':960,'units':'960x520 pixels','frozen_3d_roundtrip_max_delta':max(frozen_gap),'summary':summary,'rows':rows,'limits':['No source ground truth','No root trajectory or contact verification','Candidate pelvis from inferred torso and hips']}
 (OUT/'pelvis-score.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
