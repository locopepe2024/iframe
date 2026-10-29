"""Measure adjacent-image difference for G5 grouping; diagnostic only."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import json
ROOT=Path(__file__).resolve().parents[3];p=ROOT/'docs/agents/raw/2026-10-29-addams-vlm-phase-test-v1/dense'
rows=[]
for a,b in [(62,63),(63,64),(64,65)]:
 x=Image.open(p/f'frame-{a:03}.jpg').convert('RGB');y=Image.open(p/f'frame-{b:03}.jpg').convert('RGB')
 m=ImageStat.Stat(ImageChops.difference(x,y)).mean
 rows.append({'from':a,'to':b,'mean_abs_rgb_diff':m})
out={'schema':'addams-g5-adjacent-difference.v1','rows':rows,'interpretation':'62-63 near duplicate; 63-64 largest transition; 64-65 continuing transition','limits':['Image difference includes compression, camera and lighting changes.','It does not prove contact or pose correctness.']}
q=ROOT/'docs/agents/raw/2026-10-30-addams-motion-groups-v1/G5-adjacent-difference.json';q.write_text(json.dumps(out,indent=2)+'\n');print(q)
