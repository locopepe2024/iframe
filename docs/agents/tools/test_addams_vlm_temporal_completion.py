"""Guard contact scoring against anchor leakage and unknown denominator loss."""
import unittest
from addams_vlm_temporal_completion import TARGETS, evaluate, validate


def response():
    return {'summary': 'test', 'phases': [], 'shot_boundaries': [], 'uncertainties': [],
            'frame_states': [{'source_frame': sf, 'left_contact': 'unknown',
                              'right_contact': 'unknown', 'left_leg_phase': 'unknown',
                              'right_leg_phase': 'unknown', 'identity_basis': 'unknown',
                              'evidence_frame_ids': [sf], 'observation': '', 'inference': '',
                              'certainty': 'low'} for sf in TARGETS]}


class CompletionTests(unittest.TestCase):
    def test_anchor_excluded_unknowns_not_dropped(self):
        data = response()
        self.assertEqual(validate(data), [])
        score = evaluate(data)
        self.assertEqual(score['comparable_frames'], 5)
        self.assertNotIn(49, [row['source_frame'] for row in score['rows']])
        self.assertEqual(score['answer_coverage'], 0)
        self.assertEqual(score['all_label_agreement'], 0)
        self.assertIsNone(score['answered_agreement'])

    def test_out_of_input_evidence_rejected(self):
        data = response()
        data['frame_states'][0]['evidence_frame_ids'] = [45]
        self.assertIn('evidence_frames', validate(data))

    def test_duplicate_target_rejected(self):
        data = response()
        data['frame_states'][0]['source_frame'] = 49
        self.assertIn('target_coverage', validate(data))


if __name__ == '__main__':
    unittest.main()
