"""Prepare a verified temporal/K bundle, without pose inference."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'docs/agents/raw/2026-10-23-gvhmr-input-bundle'
EVENTS = [1,17,23,29,41,55,191,195,197,203,205,209,211]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def nearest(times, targets):
    # Explicit earlier tie rule; searchsorted also handles exact endpoints.
    upper = np.clip(np.searchsorted(times, targets), 0, len(times)-1)
    lower = np.clip(upper-1, 0, len(times)-1)
    return np.where(abs(targets-times[lower]) <= abs(times[upper]-targets), lower, upper)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', type=Path, default=Path('/private/tmp/recreation2-clip-exact10.mp4'))
    parser.add_argument('--output-video', type=Path, default=Path('/private/tmp/recreation2-gvhmr-input-30hz-20261023.mkv'))
    args = parser.parse_args()
    assert np.array_equal(nearest(np.array([10.,12.,14.]),np.array([9.,11.,12.,15.])), [0,0,1,2])
    prior_path = ROOT/'docs/agents/raw/2026-10-22-independent-pose/report.json'
    prior = json.loads(prior_path.read_text())
    video_hash = digest(args.video)
    assert video_hash == prior['input_sha256']['/private/tmp/recreation2-clip-exact10.mp4']
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
        '-show_frames','-show_entries','frame=best_effort_timestamp_time,width,height','-of','json',str(args.video)]))
    times = np.array([float(x['best_effort_timestamp_time']) for x in probe['frames']])
    assert len(times)==308 and np.all(np.diff(times)>0)
    width,height = probe['frames'][0]['width'],probe['frames'][0]['height']
    grid = times[0]+np.arange(int(np.floor((times[-1]-times[0])*30+1e-9))+1)/30
    chosen = nearest(times,grid)
    cap = cv2.VideoCapture(str(args.video))
    frames=[]
    while True:
        ok,frame=cap.read()
        if not ok:break
        assert frame.shape==(height,width,3)
        frames.append(frame)
    cap.release()
    assert len(frames)==len(times)
    encoder=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
        '-s',f'{width}x{height}','-r','30','-i','pipe:0','-an','-c:v','ffv1','-level','3',
        '-pix_fmt','bgr0',str(args.output_video)],stdin=subprocess.PIPE)
    expected=[]
    for index in chosen:
        frame=frames[index]
        encoder.stdin.write(frame.tobytes())
        expected.append(hashlib.sha256(frame.tobytes()).hexdigest())
    encoder.stdin.close()
    assert encoder.wait()==0
    cap=cv2.VideoCapture(str(args.output_video));decoded=[]
    while True:
        ok,frame=cap.read()
        if not ok:break
        decoded.append(hashlib.sha256(frame.tobytes()).hexdigest())
    cap.release()
    assert decoded==expected
    reprobe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
        '-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(args.output_video)]))
    encoded_times=np.array([float(r['best_effort_timestamp_time']) for r in reprobe['frames']])
    assert len(encoded_times)==len(grid) and np.max(abs(encoded_times-np.arange(len(grid))/30))<.001
    K=np.array(prior['K'],dtype=np.float64)
    # Hypothesis only: rotation_6d convention, NOT an estimated camera track.
    identity=np.tile([1.,0.,0.,0.,1.,0.],(len(grid),1))
    OUT.mkdir(parents=True,exist_ok=True)
    np.savez(OUT/'camera-inputs.npz',K_fullimg=np.repeat(K[None],len(grid),axis=0),
             model_time_s=grid-times[0],source_pts_s=times[chosen],source_frame_1based=chosen+1,
             STATIC_HYPOTHESIS_ONLY_cam_angvel_6d=identity)
    rows=[{'model_frame_0based':i,'model_time_s':float(grid[i]-times[0]),
           'output_container_pts_s':float(encoded_times[i]), 'source_frame_1based':int(s+1),
           'source_pts_s':float(times[s]),'sampling_offset_ms':float(1000*(times[s]-grid[i])),
           'decoded_bgr_sha256':expected[i]} for i,s in enumerate(chosen)]
    for row in rows:
        row['sample_offset_exceeds_one_model_step'] = abs(row['sampling_offset_ms']) > 1000/30
    source_gaps=[{'source_frames_1based':[int(i+1),int(i+2)], 'pts_s':[float(times[i]),float(times[i+1])],
                  'gap_ms':float(1000*(times[i+1]-times[i]))}
                 for i in np.where(np.diff(times)>2/30)[0]]
    events=[]
    for event in EVENTS:
        idx=int(nearest(grid,np.array([times[event-1]]))[0])
        events.append({'requested_source_frame':event,'requested_source_pts_s':float(times[event-1]),
            'nearest_model_frame_0based':idx,'selected_source_frame_1based':int(chosen[idx]+1),
            'exact_source_frame_retained':bool(chosen[idx]==event-1),
            'official_retime_same_ordinal_time_error_ms':float(1000*((event-1)/30-(times[event-1]-times[0])))})
    report={'schema':'recreation2-gvhmr-input-bundle.v1','source_video_sha256':video_hash,
        'diagnostic_video_path':str(args.output_video),'diagnostic_video_sha256':digest(args.output_video),
        'tool_sha256':digest(__file__),'camera_inputs_sha256':digest(OUT/'camera-inputs.npz'),
        'source_frame_count':len(times),'model_frame_count':len(grid),'source_pts_span_s':float(times[-1]-times[0]),
        'official_retime_last_frame_time_error_ms':float(1000*((len(times)-1)/30-(times[-1]-times[0]))),
        'unique_source_frames_retained':len(set(chosen.tolist())),
        'skipped_source_frame_count':len(times)-len(set(chosen.tolist())),
        'repeated_model_frame_count':len(chosen)-len(set(chosen.tolist())),
        'sampling_absolute_offset_max_ms':float(np.max(abs(times[chosen]-grid))*1000),
        'source_gaps_exceeding_two_model_steps':source_gaps,
        'sample_offset_exceeds_one_model_step_count':sum(x['sample_offset_exceeds_one_model_step'] for x in rows),
        'strict_temporal_acceptance':not source_gaps and all(e['exact_source_frame_retained'] for e in events),
        'strict_temporal_acceptance_checks':{'no_source_gap_over_two_model_steps':not bool(source_gaps),
            'all_requested_event_frames_retained':all(e['exact_source_frame_retained'] for e in events)},
        'verification':{'all_decoded_selected_frame_hashes_match':True,'frame_count_match':True,
                        'encoded_grid_pts_error_max_ms':float(np.max(abs(encoded_times-np.arange(len(grid))/30))*1000)},
        'events':events,'frames':rows,'K':K.tolist(),
        'limits':['No model/preprocess inference or accuracy results',
            'Nearest-neighbour temporal resampling may skip or duplicate source frames; inspect event mapping',
            'FFV1 preserves decoded OpenCV BGR pixels, not original encoded video bytes',
            'Identity camera rotation is an explicit unverified static hypothesis; no estimated gravity/height',
            'No bbox, kp2d, f_imgseq produced: this is an input bundle, NOT a complete model-ready batch',
            'Target must be independently verified as central yellow-clothed person',
            'Effective K candidate is not recovered true camera K']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['frames','limits']},indent=2))


if __name__=='__main__':main()
