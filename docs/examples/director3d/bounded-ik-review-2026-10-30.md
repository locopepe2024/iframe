# Bounded support IK trial

## Observed

Media Blender 4.5.9 evaluated Walk_Loop on the pinned target blend. Default
playback remains unchanged. The experiment uses explicit left sole vertex 5342,
frames 0..4, pelvis displacement and ankle pivot; rest-axis correction is off.
Weights are [0, 0.5, 1, 0.5, 0]. This is a design hypothesis, not authored support.

The original zero-route trial was rejected when its requested displacement
exceeded 5 cm. Blender printed a Python exception but returned zero without
`--python-exit-code 1`; subsequent validation commands use that option. Do not
interpret Blender's default exit status alone as probe success.

A separate route was fitted from the original contact's horizontal movement,
explicitly labeled numerical plumbing only. Under that route, residuals were:

- Maximum evaluated ankle residual: 4.57e-7 m.
- Maximum evaluated knee residual: 1.69e-7 m.
- Full-weight selected sole anchor residual (frame 2): 0.000556 m.
- Zero-weight endpoints retain original sole heights, about 3.84 and 1.80 cm.

`bounded-ik-trial-summary-2026-10-30.json` records raw report and input hashes,
annotation, route, weights and per-frame metrics. Remote raw report:
`/tmp/iframe-quaternius-20261007/ik-fitted-final-20261030.json`.

## Direct implication

The analytical two-bone solve can move evaluated joints accurately on this
five-frame single-foot trial while preserving bone lengths. The skinned sole
point does not follow the ankle perfectly; its measured residual remains
separate. Requests over 5 cm, unreachable targets, invalid knee poles and
joint residuals over 0.1 mm are rejected rather than silently clamped.

## Not yet proven

The route is fitted, so low horizontal drift cannot establish valid speed or
no-sliding gait. A two-frame envelope only defines release weights; animation
velocity/acceleration continuity and knee continuity over an entire cycle are
not accepted by these metrics. No corrected video was inspected. Other sole
vertices, opposing foot, heel/toe roll, two-foot constraints, loop transitions,
terrain, and real user routes remain unvalidated. No production contact gate
or reusable motion asset is approved by this experiment.

Verification: 43 focused tests, Python compilation, diff check, and final media
run with `--python-exit-code 1`. Follow-up requires actual reviewed support
intervals and route trajectories, full-cycle residual/penetration checks and
rendered transition review before any runtime integration.
