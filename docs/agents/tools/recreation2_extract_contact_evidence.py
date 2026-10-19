"""Extract exact decoded source frames and a reproducible foot crop sheet."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

p = argparse.ArgumentParser()
p.add_argument('--video', required=True)
p.add_argument('--out', required=True)
a = p.parse_args()
root = Path(a.out)
root.mkdir(parents=True, exist_ok=True)
frames = [1,17,23,27,29,31,33,35,37,41,43,45,47,49,51,55]
select = '+'.join(f'eq(n,{n-1})' for n in frames)
raw = subprocess.run(['ffmpeg','-v','error','-i',a.video,'-vf',
    f"select='{select}',scale=1394:792,format=rgb24",'-fps_mode','passthrough',
    '-f','rawvideo','-'], capture_output=True, check=True).stdout
pts = json.loads(subprocess.run(['ffprobe','-v','error','-select_streams','v:0',
    '-show_entries','frame=best_effort_timestamp_time','-of','json',a.video],
    capture_output=True, check=True).stdout)['frames']
size = 1394 * 792 * 3
assert len(raw) == size * len(frames)
sheet = Image.new('RGB', (1600,1080), (18,18,18))
draw = ImageDraw.Draw(sheet)
for i, frame in enumerate(frames):
    img = Image.frombytes('RGB', (1394,792), raw[i*size:(i+1)*size])
    img.save(root / f'source-{frame:03}.png')
    x, y = i % 4 * 400, i // 4 * 270
    sheet.paste(img.crop((520,480,900,740)), (x,y+10))
    draw.text((x+5,y+12), f'source {frame} | crop x520 y480', fill='yellow')
sheet.save(root / 'sole-evidence-crops.png')
manifest = {'schema': 'recreation2-source-contact-extraction.v1',
    'source_sha256': hashlib.sha256(Path(a.video).read_bytes()).hexdigest(),
    'resolution': [1394,792], 'crop_xyxy': [520,480,900,740],
    'frames': [{'source_frame': n, 'source_pts_s': float(pts[n-1]['best_effort_timestamp_time'])} for n in frames]}
(root / 'extraction.json').write_text(json.dumps(manifest, indent=2) + '\n')
