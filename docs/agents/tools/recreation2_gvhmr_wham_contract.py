"""Execute exact upstream camera helpers on CPU; no neural inference."""
import argparse
import ast
import hashlib
import json
import platform
from pathlib import Path
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/agents/raw/2026-10-23-gvhmr-wham-contract'
COMMITS = {'gvhmr': 'ee960bb6e2ea2d381aa97f08e9b71ef320b624b1',
           'wham': '2b54f7797391c94876848b905ed875b154c4a295'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def helpers(path, names):
    tree = ast.parse(path.read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    namespace = {'torch': torch, 'np': np}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--gvhmr-dir', type=Path, required=True)
    parser.add_argument('--wham-dir', type=Path, required=True)
    parser.add_argument('--gvhmr-tree', type=Path, required=True)
    args = parser.parse_args()
    g = helpers(args.gvhmr_dir/'hmr4d/utils/geo/hmr_cam.py',
                ['estimate_focal_length', 'estimate_K', 'create_camera_sensor',
                 'compute_transl_full_cam', 'compute_bbox_info_bedlam'])
    w = helpers(args.wham_dir/'lib/utils/imutils.py', ['compute_cam_intrinsics'])
    wc = helpers(args.wham_dir/'lib/models/smpl.py', ['convert_pare_to_full_img_cam'])
    vo = helpers(args.gvhmr_dir/'hmr4d/utils/preproc/relpose/utils.py', ['focal_length_from_mm'])
    camera_path = ROOT/'docs/agents/raw/2026-10-22-geocalib-effective-camera/report.json'
    camera = json.loads(camera_path.read_text())
    K = torch.tensor(camera['shared_early_result']['K'][0], dtype=torch.float64)
    width, height = 1394, 792
    kg = g['estimate_K'](width, height)
    kw = w['compute_cam_intrinsics'](torch.tensor([width, height]))[0]
    assert torch.allclose(kg, kw)
    f = K[0,0].item()
    f_default = kg[0,0].item()
    equiv = f / np.hypot(width, height) * np.hypot(36, 24)
    box = torch.tensor([[[700., 400., 400.]]], dtype=torch.float64)
    pred = torch.tensor([[[1., .1, .2]]], dtype=torch.float64)
    kk = K[None,None]
    t = g['compute_transl_full_cam'](pred, box, kk)
    k_shift = kk.clone()
    k_shift[...,0,2] += 20
    k_shift[...,1,2] += 15
    t_shift = g['compute_transl_full_cam'](pred, box, k_shift)
    assert torch.allclose(t_shift-t, torch.tensor([[[-.1,-.075,0.]]],dtype=t.dtype))
    k_fy = kk.clone(); k_fy[...,1,1] *= 1.2
    assert torch.equal(t, g['compute_transl_full_cam'](pred,box,k_fy))
    assert torch.equal(g['compute_bbox_info_bedlam'](box,kk), g['compute_bbox_info_bedlam'](box,k_fy))
    def wham_translation(k):
        return wc['convert_pare_to_full_img_cam'](pred, box[...,2], box[...,:2],
                 torch.tensor([[width]]), torch.tensor([[height]]), k[...,0,0])
    tw = wham_translation(kk)
    assert torch.equal(tw, wham_translation(k_shift))
    doubled = kk.clone(); doubled[...,0,0] *= 2; doubled[...,1,1] *= 2
    td = g['compute_transl_full_cam'](pred,box,doubled)
    assert torch.allclose(td[...,:2], t[...,:2]) and torch.allclose(td[...,2], 2*t[...,2])
    # Execute the same CUDA information query as both demo entrypoints.
    try:
        cuda_query = {'device': torch.cuda.get_device_name()}
    except Exception as exc:
        cuda_query = {'error_type': type(exc).__name__, 'message': str(exc)}
    manifests = {}
    for name, directory in [('gvhmr',args.gvhmr_dir),('wham',args.wham_dir)]:
        selected = sorted(directory.rglob('*.py')) if name=='gvhmr' else [directory/p for p in
            ['demo.py','lib/data/datasets/dataset_custom.py','lib/data/utils/normalizer.py',
             'lib/models/preproc/slam.py','lib/models/smpl.py','lib/models/wham.py',
             'lib/models/layers/utils.py','lib/models/__init__.py','lib/vis/run_vis.py','lib/utils/imutils.py']]
        manifests[name] = {str(p.relative_to(directory)): digest(p) for p in selected}
    tree = json.loads(args.gvhmr_tree.read_text())
    assert tree['sha'] == COMMITS['gvhmr'] and not tree['truncated']
    blobs = {x['path']: x['sha'] for x in tree['tree'] if x['type']=='blob'}
    for path in manifests['gvhmr']:
        data = (args.gvhmr_dir/path).read_bytes()
        assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == blobs[path]
    asset_paths = {
        'gvhmr': ['inputs/checkpoints/gvhmr/gvhmr_siga24_release.ckpt',
                  'inputs/checkpoints/body_models/smplx/SMPLX_NEUTRAL.npz',
                  'inputs/checkpoints/vitpose/vitpose-h-multi-coco.pth',
                  'inputs/checkpoints/hmr2/epoch=10-step=25000.ckpt'],
        'wham': ['dataset/body_models/smpl/SMPL_NEUTRAL.pkl',
                 'dataset/body_models/J_regressor_feet.npy',
                 'checkpoints/wham_vit_bedlam_w_3dpw.pth.tar', 'checkpoints/hmr2a.ckpt']}
    assets = {name: {p:(directory/p).is_file() for p in asset_paths[name]}
              for name,directory in [('gvhmr',args.gvhmr_dir),('wham',args.wham_dir)]}
    report = {'schema':'recreation2-gvhmr-wham-contract.v1', 'upstream_commits':COMMITS,
        'runtime': {'platform':platform.platform(), 'torch':torch.__version__,
                    'cuda_available':torch.cuda.is_available(), 'mps_available':torch.backends.mps.is_available(),
                    'official_cuda_query':cuda_query},
        'camera': {'effective_K':K.tolist(), 'effective_camera_report_sha256':digest(camera_path),
                   'default_K_both':kg.tolist(), 'default_minus_effective_f_px':f_default-f,
                   'default_relative_f_difference_percent':100*(f_default/f-1),
                   'equivalent_fullframe_mm_under_gvhmr_diagonal_convention':equiv,
                   'gvhmr_cli_43mm_f_px':g['create_camera_sensor'](width,height,43)[2][0,0].item(),
                   'simplevo_default24mm_f_full_resolution_px':vo['focal_length_from_mm'](width,height,24)},
        'synthetic_helper_execution': {'gvhmr_baseline_translation':t.tolist(),
            'gvhmr_shifted_principal_translation':t_shift.tolist(),
            'wham_baseline_translation':tw.tolist(), 'wham_shifted_principal_translation':wham_translation(k_shift).tolist(),
            'gvhmr_fy_only_change_ignored_in_condition_and_translation':True,
            'gvhmr_double_f_doubles_root_z_at_fixed_prediction':True,
            'scope':'AST-extracted exact upstream function definitions on synthetic inputs; not end-to-end model inference'},
        'source_sha256':manifests, 'tool_sha256':digest(__file__),
        'gvhmr_source_blob_verification':{'matched_file_count':len(manifests['gvhmr']),
                                        'tree_json_sha256':digest(args.gvhmr_tree)},
        'required_asset_presence_at_reviewed_roots':assets,
        'limits':['No WHAM/GVHMR model inference, no source motion accuracy measurements',
                  'No authenticated model download, production changes or CPU port',
                  'Default f is a heuristic, not an estimated source parameter']}
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['runtime','camera','synthetic_helper_execution']},indent=2))


if __name__ == '__main__':
    main()
