# Shared world route validation

## Observed

The new shared-route gate compares XYZ route translations for overlapping
support intervals with a 0.1 mm tolerance. The alternating 33-frame fixture
(left 0..8, right 16..24) has no overlap and reports `shared: true` without
claiming a continuous route. The simultaneous 0..4 fixture uses independently
fitted left/right routes and reports a conflict at frame 1.

Media Blender 4.5.9 confirmed both behaviors with `--python-exit-code 1`:

- Alternating IK run completed as `candidate_only`.
- Simultaneous IK run failed closed with
  `support IK requires one shared world route on overlapping intervals`.

## Direct implication

The two-foot solver can no longer accept independent fitted routes as if they
were one character trajectory. This closes a false-positive path in numerical
dual-foot experiments.

## Not yet proven

A route passing this gate is only internally consistent. It does not prove
authored intent, speed, heading, terrain adaptation, no sliding or contact.
Non-overlapping intervals still require transition and world-route checks.
Production playback and motion catalog remain unchanged.
