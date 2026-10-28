import copy,json,unittest
from addams_full_joint_review import normalize,JOINTS,OUT,digest

class FullJointReviewTests(unittest.TestCase):
 def setUp(self):
  self.p=json.loads((OUT/'tasks.json').read_text());self.h=digest(OUT/'tasks.json');t=self.p['tasks'][0]
  self.row={'source_frame':t['source_frame'],'image_sha256':t['image_sha256'],'identity':'visible_undetected','contact':'uncertain','status':'reviewed','joints':{n:{'xy_px':None,'visibility':'uncertain','semantic':'joint','confirmed':True} for n in JOINTS}}
  self.d={'schema':'addams-full-joint-review.v1','tasks_sha256':self.h,'source_sha256':self.p['source_sha256'],'frames':[self.row]}
 def test_sparse_uncertain_points_remain_usable_as_review_not_measurements(self):
  r=normalize(self.d,self.p,self.h);self.assertEqual(r['reviewed_count'],1);self.assertEqual(r['pending_count'],98);self.assertIsNone(r['frames'][0]['joints']['left_hip']['xy_px'])
 def test_predictions_cannot_be_imported_as_confirmation(self):
  self.row['joints']['left_knee']['confirmed']=False
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
 def test_visible_requires_position(self):
  self.row['joints']['left_knee']['visibility']='visible'
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
 def test_contour_semantics_preserved(self):
  self.row['joints']['left_hip'].update(xy_px=[100,200],visibility='visible',semantic='body_contour')
  self.assertEqual(normalize(self.d,self.p,self.h)['frames'][0]['joints']['left_hip']['semantic'],'body_contour')
 def test_stale_and_duplicates_rejected(self):
  self.d['tasks_sha256']='old'
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
  self.d['tasks_sha256']=self.h;self.d['frames']*=2
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
 def test_absent_cannot_be_pose_review(self):
  self.row['identity']='absent'
  with self.assertRaises(ValueError):normalize(self.d,self.p,self.h)
  self.row['status']='not_evaluable';self.assertEqual(normalize(self.d,self.p,self.h)['reviewed_count'],1)
 def test_all_native_images_exist_and_match_size(self):
  from PIL import Image
  self.assertEqual(len(self.p['tasks']),99)
  for t in self.p['tasks']:
   p=OUT/t['image'];self.assertEqual(digest(p),t['image_sha256'])
   with Image.open(p) as im:self.assertEqual(list(im.size),t['native_size'])
if __name__=='__main__':unittest.main()
