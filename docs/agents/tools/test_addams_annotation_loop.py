"""Behavioral checks. Synthetic annotations are test fixtures, never exported as reviews."""
import copy
import json
import os
import unittest
from pathlib import Path
from addams_annotation_loop import normalize,JOINTS

BASE=Path(os.environ['ADDAMS_TEST_BASE']) if 'ADDAMS_TEST_BASE' in os.environ else Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
PACKAGE=BASE/'addams-annotation-loop'


def submitted(tasks):
    result=copy.deepcopy(tasks)
    for task in result:
        regions=copy.deepcopy(task.pop('predictions')[0]['result'])
        regions += [{'id':n,'from_name':'visibility','value':{'choices':['visible']}} for n in JOINTS]
        regions += [{'from_name':'frame_status','value':{'choices':['reviewed']}},{'from_name':'contact','value':{'choices':['uncertain']}}]
        task['annotations']=[{'result':regions}]
    return result


class ReviewTests(unittest.TestCase):
    def setUp(self):self.tasks=json.loads((PACKAGE/'tasks.json').read_text())
    def test_predictions_are_pending(self):
        result=normalize(self.tasks,self.tasks,PACKAGE)
        self.assertFalse(result['solver_ready']);self.assertTrue(all(not r['joints'] and r['status']=='pending' for r in result['frames']))
    def test_roundtrip_and_occlusion(self):
        tasks=submitted(self.tasks);regions=tasks[0]['annotations'][0]['result']
        r=next(r for r in regions if r.get('from_name')=='visibility' and r['id']=='left_knee');r['value']['choices']=['occluded']
        result=normalize(tasks,self.tasks,PACKAGE)
        self.assertTrue(result['solver_ready']);self.assertEqual(result['frames'][0]['joints']['left_knee']['visibility'],'occluded')
        expected=self.tasks[0]['predictions'][0]['result'][0]['value']['x']*9.6
        self.assertAlmostEqual(result['frames'][0]['joints']['left_hip']['xy_px'][0],expected)
    def test_stale_inputs_rejected(self):
        for key,value in [('source_pts_s',999),('image_sha256','bad'),('image_width',3840)]:
            with self.subTest(key=key):
                tasks=submitted(self.tasks);tasks[0]['data'][key]=value
                with self.assertRaises(ValueError):normalize(tasks,self.tasks,PACKAGE)
    def test_uncertain_frame_and_missing_frame(self):
        tasks=submitted(self.tasks);tasks[0]['annotations'][0]['result'][-2]['value']['choices']=['not_evaluable']
        self.assertFalse(normalize(tasks,self.tasks,PACKAGE)['solver_ready'])
        self.assertFalse(normalize(tasks[1:],self.tasks,PACKAGE)['solver_ready'])
    def test_explicit_visibility_required(self):
        tasks=submitted(self.tasks);tasks[0]['annotations'][0]['result']=[r for r in tasks[0]['annotations'][0]['result'] if r.get('from_name')!='visibility']
        with self.assertRaises(ValueError):normalize(tasks,self.tasks,PACKAGE)
    def test_duplicate_and_invalid_points_rejected(self):
        tasks=submitted(self.tasks);tasks[0]['annotations'][0]['result'][0]['value']['x']=float('nan')
        with self.assertRaises(ValueError):normalize(tasks,self.tasks,PACKAGE)
        with self.assertRaises(ValueError):normalize(self.tasks+[self.tasks[0]],self.tasks,PACKAGE)
    def test_ambiguous_annotations_rejected(self):
        tasks=submitted(self.tasks);tasks[0]['annotations']*=2
        with self.assertRaises(ValueError):normalize(tasks,self.tasks,PACKAGE)


class SolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import addams_annotation_solve
        except ModuleNotFoundError as e:
            if e.name not in ['numpy','scipy']:raise
            raise unittest.SkipTest('Run solver checks in media motion-pose environment with scipy')
        cls.module=addams_annotation_solve
        p=BASE/'addams-fixed-rig'
        cls.control,cls.camera,cls.rig=[json.loads((p/n).read_text()) for n in ['distributed-control.json','distributed-score.json','fixed-rig-report.json']]
    def test_pending_cannot_solve(self):
        tasks=json.loads((PACKAGE/'tasks.json').read_text());review=normalize(tasks,tasks,PACKAGE)
        with self.assertRaises(ValueError):self.module.solve(review,self.control,self.camera,self.rig)
    def test_synthetic_recovery_and_hidden_point_exclusion(self):
        # Project a known fixed-length baseline at shared depth. This is not source-video evidence.
        tasks=json.loads((PACKAGE/'tasks.json').read_text());review=normalize(submitted(tasks),tasks,PACKAGE)
        raw={r['source_frame']:r for r in self.control['rows'] if r['case']=='distributed_swing'}
        cam={r['source_frame']:r for r in self.camera['rows'] if r['case']=='distributed_swing'};z=cam[21]['translation'][2]
        for frame in review['frames']:
            sf=frame['source_frame'];xyz=raw[sf]['xyz_right_down_forward'];t=cam[sf]['translation']
            for n,j in frame['joints'].items():j['xy_px']=[960*(xyz[n][k]+t[k])/(xyz[n][2]+z)+[480,260][k] for k in range(2)]
        solved=self.module.solve(review,self.control,self.camera,self.rig,weights=(0,))
        candidate=solved['candidates'][0]
        self.assertTrue(candidate['optimizer_success']);self.assertLess(candidate['metrics']['visible_joint_rmse_px'],.001)
        hidden=copy.deepcopy(review);hidden['frames'][0]['joints']['left_knee']['visibility']='occluded'
        other=copy.deepcopy(hidden);other['frames'][0]['joints']['left_knee']['xy_px']=[-99999,99999]
        a=self.module.solve(hidden,self.control,self.camera,self.rig,weights=(0,));b=self.module.solve(other,self.control,self.camera,self.rig,weights=(0,))
        self.assertEqual(a['visible_joint_count'],29)
        self.assertEqual(a['candidates'],b['candidates'])


if __name__=='__main__':unittest.main()
