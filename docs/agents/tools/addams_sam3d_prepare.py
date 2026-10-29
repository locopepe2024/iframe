"""Freeze source-only inputs for a gated SAM3D comparison; no inference claim."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT/'docs/agents/raw/2026-10-29-addams-sam3d-evaluation-v1'
FRAMES = ROOT/'docs/agents/raw/2026-10-29-addams-vlm-phase-test-v1/dense'
OUT.mkdir(exist_ok=True)
(OUT/'images').mkdir(exist_ok=True)
native = json.loads((ROOT/'docs/agents/raw/2026-10-29-addams-native-layered-v1/camera-fit.json').read_text())['baseline_camera']
rows=[]
for sf in [49,51,53,55,56,62,64]:
    source=FRAMES/f'frame-{sf:03}.jpg'
    dest=OUT/'images'/source.name
    shutil.copyfile(source,dest)
    with Image.open(dest) as im:
        size=list(im.size)
    assert size == [960,520],size
    rows.append({'source_frame':sf,'pts_s':(sf-1)/25,'file':'images/'+dest.name,
                 'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'size':size,
                 'image_transform':'existing diagnostic resize; no new crop or enhancement',
                 'primary_person_bbox_xyxy':None,
                 'user_semantics':{'both_feet_airborne':True,'right_toe_higher_than_left':True} if sf==64 else {}})
f=native['focal_px'];cx,cy=native['principal']
report={'schema':'addams-sam3d-evaluation-input.v1','inference_status':'not_run',
        'source_fps':25,'frames':rows,'camera_K':[[f,0,cx],[0,f,cy],[0,0,1]],
        'camera_status':'fixed native GVHMR candidate, not calibrated ground truth',
        'bbox_status':'pending verified primary-person ROI; do not pass null as whole-image person crop',
        'initial_keypoint_prompting':False,'acceptance':['Visible joints with matching anatomical semantics only.',
        'Report full leg chain, ankle degradation, side view and left/right identity.',
        'Shoe proxies scored separately; do not infer contact from single-frame proximity.',
        'Do not claim video continuity from seven independent image predictions.'],
        'runtime_observed':{'media_torch':'2.3.0+cpu','media_cuda_available':False,
                            'anonymous_checkpoint_http':401,'checkpoint_error':'GatedRepo'},
        'remaining_requirements':['Authorized official checkpoint access.',
                                  'CUDA runtime or independently verified CPU adaptation.',
                                  'Verified primary person ROI for each frame.']}
(OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(OUT/'manifest.json')
