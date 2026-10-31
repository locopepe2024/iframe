# Phase-aware sole refinement (offline, opt-in)

Observed: the numerical world-route fixture has roughly 0.9 mm selected-vertex
residual during full-weight IK and about 10 mm endpoint residual at zero weight.
The diagnostic supportAccepted flag is deliberately always false, not a failing
numeric gate. It must not be used as the reason to widen solver acceptance.

Add --sole-refine only with --support-ik. Refine only full-weight frames, at most
three extra evaluated-mesh corrections toward the original fixed world anchor.
Keep original foot orientation preservation, knee pole, reach checks and 5 cm
requested-offset bound. Also bound cumulative ankle displacement from its original
pose to 5 cm, so repeated small corrections cannot bypass the limit. Residual
increases fail rather than silently accepting a worsened solve. Do not alter
entry/exit weights, trajectory, annotations or production playback.

Report entry/exit, ramp and full-weight residuals separately, with full-weight
selected-vertex horizontal drift/speed, plus full sole-region min height and
max vertex drift/speed during full-weight frames. A fixed point is not a rigid
contact patch: patch metrics may remain poor even when the point is locked.
All contact outputs stay diagnostic_only and supportAccepted=false.

Success: local behavioral tests cover phase attribution and unsafe cumulative
requests; media Blender A/B on the same model/route/support must improve full-
weight selected-point residual, preserve ramps and report patch limits honestly.
Render paired full-body/feet video in director3d/reviews for inspection.

The optional `--sole-anchor centroid` experiment was run against the same media
white model. It failed closed at the existing `requested support offset exceeds
0.05 m` bound before IK, so no centroid result or video is accepted. The selected
region contains vertices too far from the ankle target for a direct whole-region
centroid. Keep `fixed` as the default; a usable patch anchor needs a contact-region
filter and foot-orientation model before this option can be enabled for review.

`bounded_plane_correction` converts a fitted z-plane slope into a world-axis
rotation request. It is diagnostic only and defaults to an 8 degree limit;
requests above the limit are rejected. The current fixture's 12 degree tilt is
therefore rejected rather than silently rotating the ankle. A future solver must
apply the request to a validated foot chain and remeasure patch residuals.
