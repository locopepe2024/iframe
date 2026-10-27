"""Read-only diagnostic: common-coordinate knee comparisons and review crops."""
import hashlib
import json
import math
import statistics
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / 'docs/agents/raw'
OUT = RAW / '2026-10-28-knee-coordinate-audit'
EVENTS = [1, 17, 23, 29, 41, 55]
SCALE = (640 / 1394, 360 / 792)

def scaled(p):
    return [p[0] * SCALE[0], p[1] * SCALE[1]]

def stats(v):
    # Linear interpolation, equivalent to numpy percentile(method='linear').
    s = sorted(v)
    k = (len(s)-1)*.95
    lo = int(k)
    return dict(count=len(v), median=statistics.median(v), p95=s[lo]+(s[min(lo+1,len(s)-1)]-s[lo])*(k-lo), max=max(v))

def main():
    OUT.mkdir(exist_ok=True)
    baseline_path = RAW / '2026-10-20-root-yaw/report.json'
    independent_path = RAW / '2026-10-22-independent-pose/report.json'
    a = json.loads(baseline_path.read_text())['cases']['raw_root_yaw']
    independent = json.loads(independent_path.read_text())['frames']
    observations = {f['source_frame']: f for f in a['source_observations']}
    output = {f['output_frame']: f['pixels'] for f in a['output']}
    rows, checks, summary = [], [], {}
    sheet = Image.new('RGB', (1000, 6*255), '#202020')
    for index, frame in enumerate(EVENTS):
        fi = next(i for i,f in enumerate(independent) if f['source_frame']==frame)
        f = independent[fi]
        image_path = RAW / f'2026-10-22-independent-pose/frames/source-{fi+1:02}.png'
        assert hashlib.sha256(image_path.read_bytes()).hexdigest()==f['source_image_sha256']
        image = Image.open(image_path).convert('RGB')
        assert image.size == (1394,792)
        mp = f['mediapipe_pixels']
        rtm = f['roi_variants']['1.0']['joint_pixels']
        ob = observations[frame]
        target = output[ob['new_bundle_frame']]
        for j in target:
            checks.append(abs(math.dist(target[j], scaled(mp[j]))-ob['per_joint_px'][j]))
        points = [mp[j] for j in ('left_knee','right_knee')] + [rtm[j] for j in ('left_knee','right_knee')] + [[target[j][0]/SCALE[0],target[j][1]/SCALE[1]] for j in ('left_knee','right_knee')]
        cx = sum(p[0] for p in points)/len(points)
        cy = sum(p[1] for p in points)/len(points)
        # Same crop for unlabelled review and all three overlay variants.
        box = (int(cx)-150,int(cy)-115,int(cx)+150,int(cy)+115)
        crop = image.crop(box)
        crop.save(OUT / f'source-{frame:03}-unlabelled.png')
        panels = [crop.copy() for _ in range(3)]
        for side in ('left','right'):
            j = side+'_knee'
            m,r,t = scaled(mp[j]),scaled(rtm[j]),target[j]
            delta = [t[k]-m[k] for k in range(2)]
            rows.append(dict(source_frame=frame,source_pts_s=f['source_pts_s'],output_frame=ob['new_bundle_frame'],joint=j,mp=m,rtm=r,target=t,mp_rtm_px=math.dist(m,r),target_mp_px=math.dist(t,m),target_rtm_px=math.dist(t,r),target_minus_mp_xy=delta))
            for panel,p,color in zip(panels,(mp[j],rtm[j],[t[0]/SCALE[0],t[1]/SCALE[1]]),('#28e580','#37bfff','#ff6655')):
                draw=ImageDraw.Draw(panel); x,y=p[0]-box[0],p[1]-box[1]
                draw.ellipse((x-5,y-5,x+5,y+5),outline=color,width=2)
                draw.text((x+7,y-8),side[0].upper(),fill=color)
        for col,(panel,label) in enumerate(zip(panels,('MediaPipe','RTMPose ROI1.0','Old target baseline'))):
            sheet.paste(panel,(col*330,index*255+23))
            ImageDraw.Draw(sheet).text((col*330,index*255+3),f'Frame {frame} | {label}',fill='white')
        (OUT / f'source-{frame:03}-crop.json').write_text(json.dumps(dict(source=str(image_path.relative_to(ROOT)),sha256=f['source_image_sha256'],crop_xyxy=box),indent=2)+'\n')
    assert max(checks) < .02, max(checks)
    sheet.save(OUT/'knee-three-way.png')
    for part in ('knee','wrist','ankle','elbow','shoulder','hip'):
        series = {k:[] for k in ('target_mp','target_rtm','mp_rtm')}
        for frame in EVENTS:
            f=next(f for f in independent if f['source_frame']==frame)
            t=output[observations[frame]['new_bundle_frame']]
            for side in ('left','right'):
                j=side+'_'+part; m=scaled(f['mediapipe_pixels'][j]); r=scaled(f['roi_variants']['1.0']['joint_pixels'][j])
                for k,v in [('target_mp',math.dist(t[j],m)),('target_rtm',math.dist(t[j],r)),('mp_rtm',math.dist(m,r))]: series[k].append(v)
        summary[part]={k:stats(v) for k,v in series.items()}
    report=dict(schema='recreation2-knee-coordinate-audit.v1',units='All distances: 640x360 pixels; crops: native1394x792 pixels',scale_xy=SCALE,event_frames=EVENTS,baseline='2026-10-20 raw_root_yaw, diagnostic only',input_sha256={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (baseline_path,independent_path)},percentile='linear interpolation at (n-1)*q',roundtrip_max_error_px=max(checks),summary_same_six_frames=summary,knee_rows=rows,limits=['No manual ground truth or physical knee center labels','Independent estimates are not ground truth','197 outside early baseline coverage; excluded from all summaries','No extractor, rig, camera or IK edits'])
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(roundtrip=max(checks),summary=summary,knees=rows),indent=2))

if __name__=='__main__':
    main()
