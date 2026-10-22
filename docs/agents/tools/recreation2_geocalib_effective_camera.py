"""Run pinned GeoCalib on exact full source frames; emit camera candidates only."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import torch
from geocalib import GeoCalib

EVENTS=(1,17,23,29,41,55)
SOURCE_SHA='6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0'

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def vals(t):return t.detach().cpu().numpy().tolist()

def summarize(result):
    camera=result['camera'];gravity=result['gravity']
    return {'K':vals(camera.K),'focal_xy_px':vals(camera.f),'principal_point_xy_px':vals(camera.c),
        'image_size_px':vals(camera.size),'horizontal_fov_deg':vals(torch.rad2deg(camera.hfov)),
        'vertical_fov_deg':vals(torch.rad2deg(camera.vfov)),
        'roll_pitch_deg':vals(torch.rad2deg(gravity.rp)),
        'uncertainties_raw':{k:vals(v) for k,v in result.items() if 'uncertainty' in k},
        'confidence_mean':{k:float(v.mean()) for k,v in result.items() if 'confidence' in k}}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--video',required=True);ap.add_argument('--weights',required=True)
    ap.add_argument('--repo',required=True);ap.add_argument('--out',required=True);args=ap.parse_args()
    assert sha(args.video)==SOURCE_SHA
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    frames_dir=out/'frames';frames_dir.mkdir(exist_ok=True)
    select='+'.join(f'eq(n\\,{f-1})' for f in EVENTS)
    subprocess.run(['ffmpeg','-v','error','-y','-i',args.video,'-vf','select='+select,
        '-vsync','0',str(frames_dir/'event-%02d.png')],check=True)
    pts_data=json.loads((Path(__file__).resolve().parents[1]/'raw/2026-10-21-world-companion-projection/pts-map.json').read_text())
    pts={r['track_frame']:r['source_pts_s'] for r in pts_data['sampled_track_frames']}
    torch.set_num_threads(4)
    model=GeoCalib(weights=args.weights).eval().to('cpu')
    images=[];rows=[]
    for i,frame in enumerate(EVENTS,1):
        path=frames_dir/f'event-{i:02d}.png'
        img=model.load_image(path).to('cpu');assert list(img.shape)==[3,792,1394]
        images.append(img)
        row={'source_frame':frame,'source_pts_s':pts[frame],'frame_sha256':sha(path),
             **summarize(model.calibrate(img,camera_model='pinhole'))}
        rows.append(row);print(json.dumps(row),flush=True)
    # Only the early five frames share intrinsics as an explicit candidate hypothesis.
    shared=summarize(model.calibrate(torch.stack(images[:5]),camera_model='pinhole',shared_intrinsics=True))
    report={'schema':'recreation2-geocalib-effective-camera.v1','source_video_sha256':SOURCE_SHA,
        'model_weights_sha256':sha(args.weights),'tool_sha256':sha(__file__),
        'repo_sha':subprocess.check_output(['git','-C',args.repo,'rev-parse','HEAD'],text=True).strip(),
        'torch_version':torch.__version__,'device':'cpu','frame_selection':'1-based decoded source index; full final video canvas; no person crop',
        'camera_model':'pinhole','principal_point_assumption':'center; not optimized',
        'individual_frames':rows,'shared_early_frames':list(EVENTS[:5]),'shared_early_result':shared,
        'limits':['learned camera estimate, not ground truth or metric body depth',
            'shared intrinsics is a hypothesis for first five frames, not proof of static camera',
            'uncertainties are model/optimizer outputs, not independently calibrated confidence intervals',
            'no source physical scale, original intrinsics, crop history, target rig or contact validation']}
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('DONE',flush=True)
if __name__=='__main__':main()
