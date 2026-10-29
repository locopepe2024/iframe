# Explicit support interval trial

Media Blender 4.5.9 ran Walk_Loop with pelvis translation, ankle pivot and no
rest-axis correction. Source/target hashes are bound by the annotation file.
The trial names target mesh `white-model-neutral-female-03`, vertex 5342,
left side, frames 0..4. The interval is a `design_hypothesis`, not an authored
support label. The selected vertex is simply a known member of the weighted
sole region; it is not yet an approved anatomical contact point.

All five route translations are explicitly zero. Under that assumption:

- Maximum horizontal displacement from the initial anchor: 0.21303 m.
- Maximum adjacent horizontal speed at scene evaluation 24 FPS: 1.31718 m/s.
- Height range above design plane: 0.01798..0.03838 m.
- Requested final anchor offset: approximately [0.00074, -0.21303, -0.01798] m.

No offset was applied. Status remains diagnostic_only, solverApplied=false.
This is raw contact-point movement under a trial annotation, not an in-world
sliding verdict. In-place gait normally needs route displacement; the run does
not infer or validate that displacement. A 21 cm constraint would require a
reachability/transition-aware solver and cannot justify snapping a foot.

Remote temporary report:
`/tmp/iframe-quaternius-20261007/support-trial-result-20261029.json`.
Annotation: `support-trial-20261029.json` in the same directory.

36 focused tests pass, covering route cancellation, wrong-route drift,
checksum mismatch, overlap, unknown action, invalid vertex identity, missing
coverage and non-finite route/FPS values. Production playback is unchanged.

Next: label actual heel/toe support intervals, bind them to reviewed route
trajectories, then test a bounded IK solve with release blending. No lock solver
or runtime asset integration is implemented by this slice.
