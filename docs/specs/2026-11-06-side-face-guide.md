# Side-profile geometry guide

## Contract

Extend the existing verified frontal workflow to an independent ~90° profile original from the saved reference pair. Preserve direction, identity, skin and hair pixels while making saved nose bridge projection, nose tip projection/vertical position and chin projection visible in a local preview. Do not infer a profile from the frontal photo. Manual review and explicit Apply remain required; no remote generation or character writes during local verification. Frontal behavior stays independently available.

## Geometry and verification

Use original-coordinate profile landmarks after the existing two-stage crop/view/native-detail validation. Select the visible eye independent of mirroring. Define signed forward as eye-to-nose x direction, original eye-line-to-inferior-chin as100 position units; bridge and tip projection use their own original eye-axis offsets as100. Apply mesh-measured changes from saved baseline, not raw slider percentages. Support bridge midline, nose tip and anterior chin; disclose all other unsupported measurements. Anchor the visible eye and lips; fix image perimeter and avoid folds. Do not use hallucinated far-side landmarks as deformation anchors.

Verify actual output pixels with original-texture tracking, reject unreliable or unmodified output, and recheck that output remains a single profile. Do not iteratively stretch the image to satisfy a MediaPipe prior. Show same-region before/after profile crop and an explicit target/output table. Preserve saved manual eye/nose/chin positions as the source coordinate convention. Reject missing source, clipped/degenerate controls, nonfinite coordinates, stale saved parameters and source changes. Applying saves a distinct side-guide asset and stages a profile-only prompt/reference for the existing headshot submission review, with no automatic paid call.

## Acceptance

Synthetic geometry and textured-pixel tests prove mirror symmetry, isolated-control direction/magnitude, original units, unchanged eye/lips, missing/clipped input and fold rejection. Regression checks preserve front-only behavior. Component/workbench tests exercise side-source selection, stale invalidation, review/apply, correct view prompt and no repeated numeric edit instructions. Real local-browser verification uses the current user-provided1024px original, plus mirrored and wrong-view controls; record observed outputs rather than assuming model detection proves fit. Typecheck/build and relevant tests, secret scan, PR/CI, isolated candidate and deploy/health verification.

## Pose boundary and observed validation (2026-11-07)

MediaPipe's matrix protocol uses column-major storage by default ([upstream definition](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/matrix_data.proto)); the installed tasks-vision package exposes that matrix without transposition. Use atan2(data[8], data[10]) as a pose estimate, not a measured camera angle. In local observations the current two-eye oblique original estimates about45°, while a visually reviewed near-profile diagnostic estimates about55°. The extra50–110° acceptance gate rejects the observed oblique false acceptance from the old eye-width heuristic. It is a heuristic with limited fixture coverage: it does not certify a90° camera angle, and manual photo/contour review remains required. Check both locating and final crops, and reject absent/invalid matrices.

The user's current1024px side original is oblique and rejected before deformation. It needs replacement with an independent near90°, one-visible-eye original and a saved/refitted reference pair. Existing persisted shape values are not rewritten by this change. Reopening an incompatible saved side source reports its pose error rather than silently reusing it for depth work.

The diagnostic near-profile fixture is an enlarged older crop, not a native high-detail side original. Real browser calls to createSideFaceGeometryGuide verified all five left-facing isolated/combined cases and four of five mirrored cases. Successful texture localization errors were at most0.283px, below the unchanged0.8px gate. One mirrored chin adjustment failed the output-pose gate and remains rejected. These runs establish the local deformation/check path, not native-detail quality or final generative fidelity. Synthetic checks additionally reject unchanged and flat pixel output.

The actual side guide component was exercised at1200px and390px browser widths without page overflow or browser errors. It displayed same-region comparisons and the target/output table; Apply stayed disabled until manual review. Browser verification used loopback GET-only routes with no external requests, uploads, character writes or paid generation. Component tests cover side-source replacement invalidating preview/review, and workbench tests cover staging one guide reference and a profile-only prompt without generation.
