"""Bidirectional categorical semantic interpolation; conflicts stay unknown."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SRC=ROOT/'docs/agents/raw/2026-10-30-addams-semantic-interpolation-v1/frame-semantics-seed.json'
D=json.loads(SRC.read_text()); rows=D['frames']
keys=['body_orientation','action_phase','left_leg_state','right_leg_state','heel_state','sole_evidence']
# Groups are ordered; only groups with explicit human/model semantics can anchor.
groups={}
for r in rows:groups.setdefault(r['group_id'],[]).append(r)
ordered=sorted(groups,key=lambda x:int(x[1:]))
for i,gid in enumerate(ordered):
 rs=groups[gid]
 if all(r['evidence_level']=='unassessed' for r in rs):
  prev=next((groups[ordered[j]] for j in range(i-1,-1,-1) if any(x['evidence_level']!='unassessed' for x in groups[ordered[j]])),None)
  nxt=next((groups[ordered[j]] for j in range(i+1,len(ordered)) if any(x['evidence_level']!='unassessed' for x in groups[ordered[j]])),None)
  for r in rs:
   for k in keys:
    pv=prev[-1][k] if prev else 'unknown'; nv=nxt[0][k] if nxt else 'unknown'
    if prev and nxt and pv==nv and pv!='unknown':
     r[k]=pv;r['evidence_level']='temporal_inference';r['confidence']=0.35;r['notes'].append(f'bidirectional agreement {prev[0]["group_id"]}->{nxt[0]["group_id"]}')
    else:r[k]='unknown'
  # no anchor means remains unassessed
out={'schema':'addams-semantic-interpolation-result.v1','production_eligible':False,'source_sha256':__import__('hashlib').sha256(SRC.read_bytes()).hexdigest(),'frames':rows,
 'rules':['Only bidirectional categorical agreement is expanded.','One-sided or conflicting anchors remain unknown/unassessed.','No coordinate, depth, focal or metric clearance interpolation is allowed.'],
 'coverage':{'observed_or_human':[r['source_frame'] for r in rows if r['evidence_level']=='human_confirmed'],'temporal_inference':[r['source_frame'] for r in rows if r['evidence_level']=='temporal_inference'],'unknown_or_unassessed':[r['source_frame'] for r in rows if r['evidence_level'] in ['unassessed'] or all(r[k]=='unknown' for k in keys)]}}
outp=SRC.parent/'frame-semantics-interpolated.json';outp.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(outp)
