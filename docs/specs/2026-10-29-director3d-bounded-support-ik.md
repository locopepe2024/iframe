# Bounded offline support IK experiment

Use explicit checksum-bound annotations from the support diagnostic. This is
an offline experiment only, disabled by default. Preserve input files, pelvis
and route; no runtime or catalog changes.

Solve hip/knee/ankle geometry analytically with original segment lengths and
the current knee bend plane. Reject zero-length, straight/ambiguous poles,
unreachable targets and requested sole offsets over 5 cm; do not clamp silently.
Use a two-frame smoothstep envelope with zero weight at interval endpoints.
Intervals must span at least five frames. No blending across cycle seams.

Rotate thigh/shin in pose space; preserve absolute ankle/foot/toe orientations.
Measure the selected deformed sole vertex after solving. Report raw/blended
requests, ankle residual and sole-to-fixed-anchor residual separately. Blended
boundary frames deliberately do not claim full lock. Residuals may remain due
to skin weighting. Reject invalid chain transforms rather than moving pelvis.

Verify pure geometry length preservation, reachability, pole preservation,
bounded displacement and envelope. Run media Blender against an explicit trial
annotation: default zero-route trial should reject excessive displacement.
Any fitted-route trial is numerical plumbing evidence, not validated authored
support, speed, visual quality or no-sliding acceptance.
