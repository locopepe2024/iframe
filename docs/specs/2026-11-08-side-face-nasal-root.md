# Side-profile nasal root control

## Goal

Add a separately measurable and editable nasal-root (radix) forward projection control. Preserve the existing nasal-bridge-midpoint, nasal-tip, chin, and all previously saved shape values. This control addresses root depression/low root prominence rather than changing the whole bridge.

## Behavior

- `noseRootHeight` defaults to 100, matching the existing neutral convention.
- Measure the mesh's nasal-root front point against the eye-axis depth. Transfer the signed change using the original eye-to-chin length as 100 position units, avoiding division by a small or zero root-to-eye offset. The measurement is relative to the fitted baseline, not the slider value.
- In the profile pixel guide, landmark 168 is the root and landmark 197 is the existing bridge midpoint. Move 168 by the root target, then interpolate smoothly from root displacement to the existing midpoint displacement. The nose tip remains controlled by its existing target.
- Include root in actual output texture tracking, result checks, and supported profile targets. Frontal guide behavior remains unchanged.
- Bound the local root edit with fixed forehead and visible-side brow anchors; never use far-side brow points.
- Older calibrated saves without a root baseline treat its baseline as 100, so applying the default does not change their mesh.

## Acceptance

- A root-only change has a finite non-neutral root measurement and changes the root point in both the mesh and profile pixel guide.
- Root-only pixel deformation keeps the bridge midpoint and tip within 1% of original eye-to-chin length; existing controls retain their current direction and units.
- Root movement has no visible discontinuity at the 168-to-197 transition; mirror symmetry, eye/lip anchors, output texture verification, and source-vertex parity remain valid.
- Old calibration records missing the root baseline remain finite and geometrically neutral at the default.
- Typecheck and focused measurement, profile-guide, guide-creation, and UI tests pass.

## Boundaries

No image-model generation, paid test, API/character write, threshold change, or eyelash detector is in scope. Merge and production deployment were explicitly authorized after review on 2026-11-08.

## Local validation and known limitation

The mesh root anchor uses MakeHuman source vertex 134, at `(0, 0.00872, 0.81112)` in the shipped head coordinates, above existing bridge-midpoint vertex 164. Its compact forward-deformation region excludes all other measurement anchors.

The existing real 1024px profile was checked at root controls 75, 90, 110 and 125, plus mirrored 110 and 125, using only loopback GET requests. Five of six cases passed output pose and original-texture tracking. The original-direction 110 case was rejected by the unchanged cropped-output pose gate (estimated yaw below 50 degrees); it remains rejected and must not be described as a verified production preview. Pose estimates are model outputs, not measured camera angles. This is a remaining usability limitation on this near-threshold source; do not loosen the gate or substitute diagnostic pixels for a verified guide. The user reviewed this limitation and authorized merge/deployment on 2026-11-08.
