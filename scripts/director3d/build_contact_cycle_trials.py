"""Numerical isolation fixtures, explicitly unsuitable as authored world routes."""

import json
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Build fitted-route numerical fixtures; not authored support')
parser.add_argument('directory', type=Path)
args=parser.parse_args()
p=args.directory
d=json.loads((p/'cycle-baseline-trajectories-20261030.json').read_text()); a=d['actions'][0]
items=[]
for side,start,end in [('l',0,8),('r',16,24)]:
 samples=a['samples'][side][start:end+1]
 # Choose a fixed vertex minimizing maximum absolute ground distance over this trial.
 slot=min(range(len(samples[0]['points'])),key=lambda i:max(abs(s['points'][i][2]) for s in samples))
 v=a['vertices'][side][slot]; first=samples[0]['points'][slot]
 items.append(dict(action='Walk_Loop',side=side,startFrame=start,endFrame=end,mesh=v['mesh'],vertexIndex=v['index'],provenance='design_hypothesis',evidence='Numerical trial only: fixed vertex selected for bounded height; per-interval XY route fitted to original trajectory, no continuous full-world route or authored support claim.',routeTranslationsM=[[first[0]-s['points'][slot][0],first[1]-s['points'][slot][1],0] for s in samples]))
base=dict(schema='director3d-support-annotations.v1',sourceSha256=d['sourceSha256'],targetSha256=d['targetSha256'],intervals=items)
(p/'alternating-cycle-trial.json').write_text(json.dumps(base,indent=2)+'\n')
# Simultaneous two-foot plumbing fixture: same early interval, independently fitted routes.
# This is deliberately separate from any physically coherent shared world route.
right=a['samples']['r'][:5]
slot=min(range(len(right[0]['points'])),key=lambda i:max(abs(s['points'][i][2]) for s in right)); v=a['vertices']['r'][slot]; first=right[0]['points'][slot]
base['intervals']=[dict(items[0],endFrame=4,routeTranslationsM=items[0]['routeTranslationsM'][:5]),dict(action='Walk_Loop',side='r',startFrame=0,endFrame=4,mesh=v['mesh'],vertexIndex=v['index'],provenance='design_hypothesis',evidence='Independent fitted route, simultaneous solver isolation only; not a common character trajectory.',routeTranslationsM=[[first[0]-s['points'][slot][0],first[1]-s['points'][slot][1],0] for s in right])]
(p/'simultaneous-cycle-trial.json').write_text(json.dumps(base,indent=2)+'\n')
