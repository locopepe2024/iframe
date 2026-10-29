import unittest
from addams_contact_phase_gate import frame_gate, contact_weights

class GateTests(unittest.TestCase):
    def test_flight_releases_both(self):
        result = frame_gate(64, {62: 'left', 64: 'airborne'})
        self.assertEqual((result['left'], result['right']), (0, 0))
        self.assertTrue(result['flight_confirmed'])

    def test_unknown_is_not_forward_filled_or_called_flight(self):
        result = frame_gate(63, {62: 'left', 64: 'airborne'})
        self.assertEqual((result['left'], result['right']), (0, 0))
        self.assertEqual(result['state'], 'unknown')
        self.assertFalse(result['flight_confirmed'])

    def test_explicit_contact_side(self):
        self.assertEqual((contact_weights('left')['left'], contact_weights('left')['right']), (1, 0))
        self.assertEqual((contact_weights('right')['left'], contact_weights('right')['right']), (0, 1))

    def test_invalid_state_rejected(self):
        with self.assertRaises(ValueError):
            contact_weights('running')

    def test_duplicate_model_frames_both_release(self):
        copies = [frame_gate(sf, {64: 'airborne'}) for sf in [63, 64, 64, 65]]
        self.assertTrue(all(r['left'] == r['right'] == 0 and r['flight_confirmed'] for r in copies if r['source_frame'] == 64))

if __name__ == '__main__':
    unittest.main()
