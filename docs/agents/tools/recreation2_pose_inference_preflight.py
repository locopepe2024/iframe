"""Read-only preflight for running 2D pose inference on a source clip."""
import importlib.util,json,subprocess,hashlib
from pathlib import Path
VIDEO=Path('/Users/owen/Downloads/白模/动作白模_28/白膜-亚当斯一家-CDL李紫微-09改.mp4')
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/addams-inference-preflight.json'
def main():
    packages={p:bool(importlib.util.find_spec(p)) for p in ['cv2','mediapipe','rtmlib','onnxruntime']}
    ff=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,nb_frames','-of','json',str(VIDEO)],capture_output=True,text=True,check=True)
    result={'schema':'addams-inference-preflight.v1','video_path':str(VIDEO),'video_sha256':hashlib.sha256(VIDEO.read_bytes()).hexdigest(),'stream':json.loads(ff.stdout)['streams'][0],'python_packages':packages,'ready':all(packages.values()),'required_for_current_dual_model_plan':['cv2','rtmlib','onnxruntime'],'status':'ready' if all(packages.values()) else 'blocked_missing_inference_dependencies','limits':['No pose inference was run','No model weights were downloaded','No 3D or rig result exists']}
    OUT.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if __name__=='__main__':main()
