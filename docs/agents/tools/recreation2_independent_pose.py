"""RTMPose 2D observations vs MediaPipe; neither is manual ground truth."""
import argparse
import importlib.metadata
import inspect
import json
from pathlib import Path
import subprocess
import cv2
import numpy as np
from rtmlib import RTMPose
import rtmlib.tools.base as runtime_base
import recreation2_world_perspective_fit as base
from recreation2_effective_intrinsics_scale import ROOT,FIT_NAMES

EVENTS=(1,17,23,29,41,55,195,197)
COCO={s+'_'+j:i for s,indices in [('left',[5,7,9,11,13,15]),('right',[6,8,10,12,14,16])]
      for j,i in zip(['shoulder','elbow','wrist','hip','knee','ankle'],indices)}
OUT=ROOT/'docs/agents/raw/2026-10-22-independent-pose'


def adjusted_box(box,factor):
    p=np.array(box,dtype=float).reshape(2,2)*[1394,792]
    center=p.mean(axis=0);half=(p[1]-p[0])*factor/2
    return np.r_[center-half,center+half]


def compare(a,b,names):
    e={n:float(np.linalg.norm(a[n]-b[n])) for n in names}
    return {'mean_px':float(np.mean(list(e.values()))),'rmse_px':float(np.sqrt(np.mean(np.square(list(e.values()))))),
            'max_px':max(e.values()),'per_joint_px':e}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--weights',required=True);ap.add_argument('--archive',required=True);a=ap.parse_args()
    video=Path('/private/tmp/recreation2-clip-exact10.mp4')
    pts_path=ROOT/'docs/agents/raw/2026-10-21-world-companion-projection/pts-map.json'
    track_path=pts_path.with_name('world-pts-timestamps.json')
    camera_path=ROOT/'docs/agents/raw/2026-10-22-world-camera-fit/report.json'
    k_path=ROOT/'docs/agents/raw/2026-10-22-geocalib-effective-camera/report.json'
    pts_data=json.loads(pts_path.read_text());assert base.digest(video)==pts_data['video_sha256']
    pts={r['track_frame']:r['source_pts_s'] for r in pts_data['sampled_track_frames']}
    raw={r['frame']:r for r in json.loads(track_path.read_text())['frames']}
    rotation=np.array(json.loads(camera_path.read_text())['camera_rotation_world_to_camera_columns'])
    K=np.array(json.loads(k_path.read_text())['shared_early_result']['K'][0]);focal=K[0,0]
    basis=rotation@np.diag([1,K[1,1]/K[0,0],1]);principal=K[:2,2]
    model=RTMPose(a.weights,model_input_size=(192,256),backend='onnxruntime',device='cpu',to_openpose=False)
    input_shape=model.session.get_inputs()[0].shape
    assert len(input_shape)==4 and input_shape[1:]==[3,256,192]
    OUT.mkdir(parents=True,exist_ok=True)
    frames_dir=OUT/'frames';frames_dir.mkdir(exist_ok=True)
    select='+'.join(f'eq(n\\,{i-1})' for i in EVENTS)
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-vf','select='+select,'-vsync','0',str(frames_dir/'source-%02d.png')],check=True)
    rows=[];verification={}
    bbox_gaps=[]
    for source in raw.values():
        if source.get('target_landmarks') is None or source.get('target_bbox') is None:
            continue
        landmarks=np.array(source['target_landmarks'])[:,:2]
        bbox_gaps.append(float(np.max(np.abs(np.r_[landmarks.min(axis=0),landmarks.max(axis=0)]-source['target_bbox']))))
    verification['target_bbox_vs_all33_landmark_bounds_max_difference_normalized']=max(bbox_gaps)
    verification['target_bbox_checked_frame_count']=len(bbox_gaps)
    for order,event in enumerate(EVENTS,1):
        source=raw[event];image_path=frames_dir/f'source-{order:02d}.png';img=cv2.imread(str(image_path))
        assert img.shape==(792,1394,3)
        mp={n:np.array(source['target_landmarks'][base.JOINTS[n]][:2])*[1394,792] for n in COCO}
        visibility={n:float(source['target_landmarks'][base.JOINTS[n]][3]) for n in COCO}
        world={n:np.array(source['target_world_landmarks'][base.JOINTS[n]][:3]) for n in COCO}
        row={'source_frame':event,'source_pts_s':pts[event],'source_image_sha256':base.digest(image_path),
             'mediapipe_pixels':{n:v.tolist() for n,v in mp.items()},'mediapipe_visibility':visibility,'roi_variants':{}}
        for factor in (.9,1.,1.1):
            box=adjusted_box(source['target_bbox'],factor)
            keypoints,scores=model(cv2.cvtColor(img,cv2.COLOR_BGR2RGB),bboxes=[box.tolist()]);assert keypoints.shape==(1,17,2) and scores.shape==(1,17)
            assert np.isfinite(keypoints).all() and np.isfinite(scores).all()
            xy={n:keypoints[0,idx].astype(float) for n,idx in COCO.items()}
            sc={n:float(scores[0,idx]) for n,idx in COCO.items()}
            eligible=[n for n in COCO if visibility[n]>=.2 and sc[n]>=.3]
            item={'bbox_xyxy_px':box.tolist(),'coco17_pixels':keypoints[0].tolist(),'coco17_scores':scores[0].tolist(),
                  'joint_pixels':{n:p.tolist() for n,p in xy.items()},'joint_scores':sc,
                  'eligible_common_names':eligible,'all12_disagreement':compare(xy,mp,list(COCO)),
                  'eligible_disagreement':compare(xy,mp,eligible) if eligible else None}
            # Post-hoc diagnostic only: do not swap the actual track or select this pairing.
            swapped={n:xy[('right_'+n[5:]) if n.startswith('left_') else ('left_'+n[6:])] for n in COCO}
            item['exploratory_bilateral_swap_disagreement']=compare(swapped,mp,list(COCO))
            item['forearm_image_lengths_px']={label:{s:float(np.linalg.norm(points[s+'_elbow']-points[s+'_wrist']))
                for s in ['left','right']} for label,points in [('mediapipe',mp),('rtmpose',xy)]}
            # Uniform weights and exact common membership for both observation sources.
            if len(set(eligible)&FIT_NAMES)>=6 and len(set(eligible)-FIT_NAMES)>=2:
                full={'names':eligible,'world':np.array([world[n] for n in eligible]),'weights':np.ones(len(eligible))}
                cross={}
                for label,obs in [('mediapipe',mp),('rtmpose',xy)]:
                    f={**full,'image':np.array([obs[n] for n in eligible])}
                    ids=[i for i,n in enumerate(eligible) if n in FIT_NAMES];held=[i for i,n in enumerate(eligible) if n not in FIT_NAMES]
                    fitframe={**f,**{k:f[k][ids] for k in ['world','image','weights']},'names':[eligible[i] for i in ids]}
                    fit=base.fit_translation(fitframe,basis,focal,principal)
                    if fit is None:raise ValueError('nonpositive fit')
                    residual=base.perspective_residuals(f,basis,focal,fit['params'],principal)[0]
                    cross[label+'_root']={'root_camera_xyz_model_units':fit['root_camera_xyz_model_units'],
                        'own_observation_fit_rmse_px':float(np.sqrt(np.mean(np.sum(residual[ids]**2,axis=1)))),
                        'own_observation_distal_rmse_px':float(np.sqrt(np.mean(np.sum(residual[held]**2,axis=1))))}
                    if label=='mediapipe':
                        predicted=residual+f['image']
                        cross['mediapipe_root_scored_against_rtmpose_distal_rmse_px']=float(np.sqrt(np.mean(np.sum((predicted[held]-np.array([xy[eligible[i]] for i in held]))**2,axis=1))))
                item['conditional_world_projection']=cross
            else:
                item['projection_skip_reason']='fewer than six eligible fit joints or two eligible distal joints'
            row['roi_variants'][str(factor)]=item
            if event==1 and factor==1:
                # Translate complete image+ROI together: tests pixel-coordinate return contract.
                shifted=cv2.copyMakeBorder(img,16,0,24,0,cv2.BORDER_CONSTANT,value=(0,0,0))
                k2,_=model(cv2.cvtColor(shifted,cv2.COLOR_BGR2RGB),bboxes=[(box+[24,16,24,16]).tolist()])
                gap=float(np.max(np.abs(k2-keypoints-[24,16])));assert gap<1.
                verification['image_and_roi_translation_max_coordinate_error_px']=gap
        central=row['roi_variants']['1.0'];center={n:np.array(p) for n,p in central['joint_pixels'].items()}
        for factor in ['0.9','1.1']:
            alt={n:np.array(p) for n,p in row['roi_variants'][factor]['joint_pixels'].items()}
            row['roi_variants'][factor]['change_from_central_roi']=compare(alt,center,list(COCO))
        canvas=img.copy()
        for label,points,color in [('MP',mp,(30,170,255)),('RTM',center,(70,240,40))]:
            for side in ['left','right']:
                for start,end in [('shoulder','elbow'),('elbow','wrist'),('hip','knee'),('knee','ankle'),('shoulder','hip')]:
                    cv2.line(canvas,tuple(np.rint(points[side+'_'+start]).astype(int)),tuple(np.rint(points[side+'_'+end]).astype(int)),color,2)
            for n,p in points.items():
                q=tuple(np.rint(p).astype(int));cv2.circle(canvas,q,4,color,-1)
                cv2.putText(canvas,label+' '+n,q,cv2.FONT_HERSHEY_SIMPLEX,.32,color,1)
        cv2.rectangle(canvas,(0,0),(1394,35),(0,0,0),-1)
        cv2.putText(canvas,f'Source {event} | orange MediaPipe | green RTMPose | model disagreement, NOT truth',(12,25),cv2.FONT_HERSHEY_SIMPLEX,.65,(255,255,255),1)
        cv2.imwrite(str(OUT/f'overlay-{event:03d}.jpg'),canvas)
        # Subject crop is evidence only; inference always uses full image + bbox.
        b=adjusted_box(source['target_bbox'],1.1).astype(int);b[::2]=np.clip(b[::2],0,1394);b[1::2]=np.clip(b[1::2],0,792)
        cv2.imwrite(str(OUT/f'subject-{event:03d}.jpg'),canvas[b[1]:b[3],b[0]:b[2]])
        rows.append(row)
        print(event,central['all12_disagreement']['mean_px'],flush=True)
    pose_dir=Path(inspect.getfile(RTMPose)).parent
    deps={Path(m).name:base.digest(m) for m in [inspect.getfile(RTMPose),inspect.getfile(runtime_base),
          pose_dir/'pre_processings.py',pose_dir/'post_processings.py',base.__file__]}
    report={'schema':'recreation2-independent-2d-pose.v1','model':'official RTMPose-M body7 COCO17 ONNX',
        'weight_url':'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip',
        'weight_archive_sha256':base.digest(a.archive),'onnx_sha256':base.digest(a.weights),
        'input_sha256':{str(p):base.digest(p) for p in [video,track_path,pts_path,camera_path,k_path]},
        'tool_sha256':base.digest(__file__),'dependency_sha256':deps,
        'versions':{p:importlib.metadata.version(p) for p in ['rtmlib','onnxruntime','numpy','opencv-contrib-python']},
        'providers':model.session.get_providers(),'model_input_size_wh':[192,256],'K':K.tolist(),
        'preprocessing':'cv2 image explicitly BGR to RGB per weight pipeline.json to_rgb=true (RTMLib does not convert); RTMLib affine ROI padding1.25 and mean/std, CHW float32; official postprocess returns full-image pixels',
        'weight_pipeline_sha256':base.digest(Path(a.weights).with_name('pipeline.json')),
        'onnx_input_shape':input_shape,
        'roi_source':'existing target_bbox; observed equal to all33 MediaPipe landmark bounds, not an independent detector or body silhouette',
        'eligibility':'MediaPipe visibility>=0.2 and RTMPose raw score>=0.3; scores are different constructs, not comparable probabilities',
        'common12_coco_indices':COCO,'frames':rows,'verification':verification,
        'limits':['RTMPose independent weights, but target bbox from MediaPipe; models may share training domains',
                  '2D inter-model disagreement is not pixel ground-truth error or independent 3D validation',
                  'RTMPose COCO17 has no heel/toe outputs; no contact inference',
                  'MP world projection inherits MP-fitted camera rotation; no recalibration of K from RTMPose points',
                  'eight selected frames and three ROI variants; not sequence validation',
                  'no main-chain, rig or H3 modification']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':main()
