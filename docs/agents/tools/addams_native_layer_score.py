"""Score untouched GVHMR output against existing visible-joint reviews on media."""
import json
from pathlib import Path
import cv2
import numpy as np
import torch
import smplx
from hmr4d.utils.smplx_utils import make_smplx
from hmr4d.utils.geo.hmr_cam import estimate_K, perspective_projection

B = Path('/tmp/addams-pose')
O = B / 'gvhmr-native-v1'
torch.set_num_threads(4)
mapping = json.loads((O/'frame-map.json').read_text())
review = json.loads((B/'fullbody-reviewed-input.json').read_text())
assert review['source_sha256'] == mapping['source_sha256']
assert review['image_size'] == mapping['size'] == [960, 520]
pred = torch.load(O/'hmr4d_results.pt', map_location='cpu')
params = {k: v[None] for k,v in pred['smpl_params_incam'].items()}
with torch.inference_mode():
    model = make_smplx('supermotion_v437coco17').eval()
    verts, joints = model(**params)
    K = estimate_K(960,520).repeat(1,len(mapping['frames']),1,1)
    xy = perspective_projection(joints,K)[0].numpy()
observed = torch.load(O/'vitpose.pt',map_location='cpu').numpy()
names = ['nose','left_eye','right_eye','left_ear','right_ear','left_shoulder',
         'right_shoulder','left_elbow','right_elbow','left_wrist','right_wrist',
         'left_hip','right_hip','left_knee','right_knee','left_ankle','right_ankle']
edges = [(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),
         (11,13),(13,15),(12,14),(14,16)]
rows=[]; tiles=[]
for f in review['frames']:
    sf=f['source_frame']
    matches=[r for r in mapping['frames'] if r['source_frame']==sf]
    if not matches: continue
    row=min(matches,key=lambda r:abs(r['timing_error_s'])); i=row['model_frame']
    img=cv2.imread(str(O/'frames'/f'{i:03}.png')); pts=[]
    for a,b in edges:
        cv2.line(img,tuple(np.rint(xy[i,a]).astype(int)),tuple(np.rint(xy[i,b]).astype(int)),(180,80,255),2)
    if f['status']=='reviewed' and f['identity']!='absent':
        for n,p in f['joints'].items():
            if n not in names or not p.get('confirmed') or p['visibility']!='visible' or p['semantic']!='joint':continue
            j=names.index(n); target=np.array(p['xy_px']); assert joints[0,i,j,2]>0
            v=observed[i,j,:2]; q=xy[i,j]
            pts.append({'joint':n,'review_xy':target.tolist(),'native_xy':q.tolist(),
                        'vitpose_xy':v.tolist(),'native_error_px':float(np.linalg.norm(q-target)),
                        'vitpose_error_px':float(np.linalg.norm(v-target)),
                        'vitpose_confidence':float(observed[i,j,2])})
            cv2.circle(img,tuple(np.rint(target).astype(int)),5,(0,220,255),-1)
    cv2.putText(img,f'Source {sf} | native purple; human yellow',(12,25),cv2.FONT_HERSHEY_SIMPLEX,.6,(255,255,255),1)
    cv2.imwrite(str(O/f'native-review-{sf:03}.png'),img)
    tiles.append(cv2.resize(img,(480,260)))
    rows.append({'source_frame':sf,'model_frame':i,'points':pts})
def metric(items,key):
    e=np.array([p[key] for p in items])
    return {'count':len(e),'rmse_px':float(np.sqrt(np.mean(e**2))) if len(e) else None,
            'median_px':float(np.median(e)) if len(e) else None,'max_px':float(e.max()) if len(e) else None}
allpts=[p for r in rows for p in r['points']]
report={'schema':'addams-native-layer-score.v1','size':[960,520],
        'native':metric(allpts,'native_error_px'),'vitpose':metric(allpts,'vitpose_error_px'),
        'frames':rows,'camera_K':K[0,0].tolist(),
        'limits':['Static-camera diagnostic; estimated focal, not calibration.',
                  'Existing human labels reused only for evaluation, not model conditioning.',
                  'Visible skeletal labels only; no ground-truth depth or contact acceptance.']}
(O/'human-score.json').write_text(json.dumps(report,indent=2)+'\n')
if len(tiles)%2:tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(str(O/'native-human-contact.png'),np.vstack([np.hstack(tiles[i:i+2]) for i in range(0,len(tiles),2)]))
export={'frame_map':mapping,'camera_K':K[0,0].tolist(),'coco17_projected':xy.tolist(),
        'params':{k:v.tolist() for k,v in pred['smpl_params_incam'].items()},'review':review}
native=json.loads((O/'native-motion.json').read_text())
export['native22']=native['motion']['incam']['joints']
export['parents']=native['parents']
with torch.inference_mode():
    body=smplx.SMPLX('inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz',
                     num_betas=10,use_pca=False,flat_hand_mean=True)
    rest=body(betas=pred['smpl_params_incam']['betas'].median(dim=0).values[None])
    export['rest22']=rest.joints[0,:22].tolist()
(O/'native-layer-input.json').write_text(json.dumps(export)+'\n')
print(json.dumps({k:report[k] for k in ['native','vitpose']},indent=2),flush=True)
