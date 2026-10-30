# Full-weight sole refinement experiment

Media Blender 4.5.9 ran two 33-frame Walk_Loop trials with the same pinned model,
world route and support annotations used for world-route playback. Baseline and
--sole-refine runs rendered 66 frames each. The video has baseline on top and
refined on bottom; each row shows body (left) and feet (right).

Full-weight selected-point max anchor residual changed from 0.955/0.977 mm
(left/right) to 0.00943/0.00972 mm. Horizontal speed changed from
0.00494/0.00514 m/s to 0.0000422/0.0000458 m/s. Ramp and released phase reports
were identical; release residuals still reach about 10 mm by design.

The full sole region remains problematic: refined minima -7.33/-7.67 mm, and
max horizontal vertex speeds 0.0986/0.1090 m/s. A locked selected vertex does not
make the deforming sole a locked contact patch. supportAccepted stays false.
The numerical route is fitted evidence, not an authored natural gait. These
results support only bounded point refinement on this fixture, not no sliding,
terrain adaptation, arbitrary rig support or production readiness.

Implementation: opt-in full-weight evaluated-mesh iterations (max 3); cumulative
ankle correction <=5cm; no worsening of selected-point residual; original IK
reach and knee-pole checks retained. Refined joint diagnostics retain the maximum
residual across iterations. Phase reports separate zero, partial and full weight;
speed uses only consecutive frames within a phase. Empty phases report null.

Persistent artifacts: director3d/reviews/sole-refinement-20261030/comparison.json
and refinement-ab.mp4. comparison.json is the raw media A/B result before adding
the optional maxPatchVertexDriftM report field and aggregating joint diagnostics;
these additions do not change solver output. Media files/logs remain under
/tmp/director-sole-refinement-20261030. Local tests cover phase separation,
cumulative limit, nonfinite input and moving patch vertices despite a fixed point.

Next boundary: constrained foot orientation/contact patch fitting and entry/exit
planning. Do not widen tolerance or mark a point-only result as full-foot acceptance.
No deployment, catalog promotion or UI default changes.
