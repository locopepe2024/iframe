# 33-frame contact isolation review

## Observed

Media Blender 4.5.9 ran the complete inclusive Walk_Loop 0..32 cycle for two
fixtures. Baseline input hashes, annotations, route offsets, raw report hashes
and metrics are in `whole-cycle-trial-summary-2026-10-30.json`.

1. Alternating: left 0..8 and right 16..24. Routes are fitted separately from
   original selected vertices; vertices minimize worst interval height.
2. Simultaneous: both sides 0..4 with independent fitted routes, solely to test
   solver/statistics isolation. This is not one coherent character trajectory.

Both fixtures remain design hypotheses, not authored support. All intervals
release at both endpoints and produce separate diagnostic reports.

| Measure | Alternating | Simultaneous |
|---|---|---|
| Maximum full-weight selected-point residual | 0.977 mm | 0.532 mm |
| Maximum joint residual | 2.34e-7 m | 2.34e-7 m |
| Left/right minimum selected sole Z | -7.68 / -8.04 mm | -6.52 / -4.18 mm |
| Frames with selected vertices below -1 cm | 0 / 0 | 0 / 0 |

Alternating outside-interval selected-vertex differences against baseline are
zero on both sides. Local endpoint geometry difference is about 7.07e-8 m left
and zero right. These are position measurements, not velocity continuity.

The alternating fixture rendered 66 PNGs, full-body and feet, then a 33-frame
1280×640 H.264 video at scene evaluation 24 FPS. Authored FPS remains unverified.
Contact sheets for frames 0,2,6,8,16,18,22,24 were inspected: alternating lifted
feet and continuous-looking sampled poses are visible. No temporal visual
acceptance or physical support verdict follows from still samples. The video
shows local character poses on a stationary plane; fitted route offsets are
used in the diagnostic math and are not applied to the rendered world.

## Direct implication and remaining limits

Single-leg modifications do not alter the other leg outside its own annotated
window in this test. Simultaneous samples are no longer confused with duplicate
frames by the interval statistics. There is still sub-centimeter penetration
of other selected sole vertices: locking one point does not lock a sole surface.

Fitted offsets cannot establish valid movement speed or no sliding. Shared
world-route consistency, reviewed heel/toe support labels, velocity continuity,
knee-plane continuity, terrain and real user paths remain unvalidated.
`supportAccepted` remains false and production playback/catalog are unchanged.

Temporary artifacts on media under `/tmp/iframe-quaternius-20261007/`:
`alternating-cycle-result.json`, `simultaneous-cycle-result.json`,
`alternating-cycle-sequence/` and `alternating-cycle-review.mp4`.
Local video: `/private/tmp/director-sole-review/alternating-cycle-review.mp4`.

Reproduce annotations with `build_contact_cycle_trials.py DIRECTORY` using
`cycle-baseline-trajectories-20261030.json` exported by the probe's optional
`--sole-samples-output`. Run Blender with `--python-exit-code 1`.
