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

Ground-patch selection now uses a 10 mm band above the lowest evaluated sole
vertex. Plane and orientation diagnostics operate on this filtered patch and
report selected/total counts. On the media fixture this changes full-weight tilt
from roughly 12.4–12.8 degrees to 5.2–5.5 degrees and plane residual to about
4.4 mm. This is a measurement improvement, not contact acceptance or a claim
that all selected vertices belong to one rigid support patch.

## Rotation correctness and per-frame diagnostics (2026-10-31)

The previous request had a sign error: for `z=ax+by+c`, the upward normal is
`(-a,-b,1)` and the axis `(-b,a,0)` needs the positive tilt angle to align it with
world +Z. Verify the request by actually rotating synthetic patch geometry in
multiple slope directions; an assertion on the requested angle alone is insufficient.
This fix changes diagnostic requests only, not ankle/foot poses.

Fit in centered, XY-normalized coordinates to avoid cancellation at translated
world positions. Reject rank-deficient XY patches using a relative determinant
threshold. Keep the 8 degree limit and 5 cm IK bounds unchanged.

Fit every sampled frame, including ramps and released frames. Preserve legacy
first-frame fields with explicit `patchPlaneFrame`, add `planeFrames` and the
maximum tilt of successfully fitted frames. A failed fit produces a per-frame
rejection and does not erase other contact metrics. A maximum over successful
fits is not proof that rejected frames pass. Residuals are vertical Z distances,
not perpendicular distances to the plane. Patch selection uses height relative
to its lowest vertex; this does not establish an actual ground surface.

Success criteria: reproduce and fix the wrong rotation direction, translated-fit
instability and degenerate-filter crash; expose later-frame limit violations;
verify corrected requests with media Blender mathutils on evaluated white-model
patches. This is not a foot-lock or no-sliding acceptance test.
