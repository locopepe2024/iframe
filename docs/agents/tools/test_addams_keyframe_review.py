import copy,json,unittest
from addams_keyframe_review import O,normalize,digest
class KeyframeTests(unittest.TestCase):
 def setUp(self):
  self.p=json.loads((O/'tasks.json').read_text());self.h=digest(O/'tasks.json');t=self.p['tasks'][0]
  self.d={'schema':'addams-keyframe-review.v1','tasks_sha256':self.h,'source_sha256':self.p['source_sha256'],'frames':[{'source_frame':t['source_frame'],'image_sha256':t['image_sha256'],'joints':copy.deepcopy(t['points']),'identity':t['identity'],'contact':t['contact'],'status':'reviewed','left_support':'uncertain','right_support':'uncertain'}]}
 def test_partial_save_keeps_predictions_out(self):
  p=self.d['frames'][0]['joints']['left_knee'];p.update(xy_px=[400,300],confirmed=True,visibility='visible')
  r=normalize(self.d,self.p,self.h);self.assertEqual(r['frames'][0]['joints']['left_knee']['xy_px'],[400,300]);self.assertIsNone(r['frames'][0]['joints']['right_knee']['xy_px']);self.assertFalse(r['frames'][0]['joints']['right_knee']['confirmed'])
 def test_preserves_all_existing_human_frames_and_events(self):
  self.assertEqual(len(self.p['tasks']),23);h=json.loads((O/'preserved-human-review.json').read_text());self.assertEqual([f['source_frame'] for f in h['frames']],list(range(49,59)));self.assertEqual(len(json.loads((O/'preserved-events.json').read_text())['frames']),46)
 def test_stale_duplicate_rejected(self):
  self.d['tasks_sha256']='old'
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
  self.d['tasks_sha256']=self.h;self.d['frames']*=2
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
 def test_foot_surface_is_separate_from_joint(self):
  p=self.d['frames'][0]['joints']['left_forefoot'];p.update(xy_px=[500,490],confirmed=True,visibility='visible',semantic='foot_surface');r=normalize(self.d,self.p,self.h);self.assertEqual(r['frames'][0]['joints']['left_forefoot']['semantic'],'foot_surface')
 def test_original_images_exist_and_match(self):
  for t in self.p['tasks']:self.assertEqual(digest(O/t['image']),t['image_sha256'])
if __name__=='__main__':unittest.main()
