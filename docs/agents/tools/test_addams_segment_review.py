import copy
import unittest
from addams_segment_review import normalize


class EventReviewTests(unittest.TestCase):
    def setUp(self):
        self.package = {'source_sha256': 'source', 'queue_sha256': 'queue', 'tasks': [
            {'source_frame': 159, 'image_sha256': 'image', 'pts_s': 6.32, 'segment_id': 'shot3', 'candidates': [{'id': 0}, {'id': 1}]},
            {'source_frame': 170, 'image_sha256': 'next', 'pts_s': 6.76, 'segment_id': 'shot3', 'candidates': []}]}
        self.export = {'schema': 'addams-event-review.v1', 'source_sha256': 'source', 'queue_sha256': 'queue',
                       'reviews': [{'source_frame': 159, 'image_sha256': 'image', 'identity': '1', 'contact': 'right'}]}

    def test_sparse_review_does_not_propagate_identity(self):
        result = normalize(self.export, self.package)
        self.assertEqual(result['reviewed_count'], 1)
        self.assertEqual(result['pending_count'], 1)
        self.assertEqual([f['source_frame'] for f in result['frames']], [159])
        self.assertEqual(result['frames'][0]['identity'], '1')

    def test_empty_export_stays_pending(self):
        self.export['reviews'] = []
        self.assertEqual(normalize(self.export, self.package)['pending_count'], 2)

    def test_rejects_stale_provenance(self):
        for key in ['source_sha256', 'queue_sha256']:
            export = copy.deepcopy(self.export)
            export[key] = 'changed'
            with self.assertRaises(ValueError):
                normalize(export, self.package)
        self.export['reviews'][0]['image_sha256'] = 'changed'
        with self.assertRaises(ValueError):
            normalize(self.export, self.package)

    def test_rejects_duplicate_and_unknown_candidates(self):
        export = copy.deepcopy(self.export)
        export['reviews'] *= 2
        with self.assertRaises(ValueError):
            normalize(export, self.package)
        self.export['reviews'][0]['identity'] = '2'
        with self.assertRaises(ValueError):
            normalize(self.export, self.package)

    def test_absence_cannot_confirm_contact(self):
        self.export['reviews'][0]['identity'] = 'absent'
        with self.assertRaises(ValueError):
            normalize(self.export, self.package)
        self.export['reviews'][0]['contact'] = 'uncertain'
        self.assertEqual(normalize(self.export, self.package)['reviewed_count'], 1)

    def test_visible_without_detection_is_explicit(self):
        self.export['reviews'] = [{'source_frame': 170, 'image_sha256': 'next', 'identity': 'visible_undetected', 'contact': 'other'}]
        self.assertEqual(normalize(self.export, self.package)['frames'][0]['identity'], 'visible_undetected')


if __name__ == '__main__':
    unittest.main()
