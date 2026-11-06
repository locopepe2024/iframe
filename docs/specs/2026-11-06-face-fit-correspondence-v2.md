# Face fitting landmark correspondence v2

## Observed

The original Su Yan three-view PNG produces ten automatic marks, but the front eye marks are inner canthi rather than eye centers. The profile chin mark is the lowest chin point rather than its foremost point. Mesh measurements select vertices again after every deformation, so optimization can change the measured feature as well as its position. The original sample's fitted eye ratio differs from its image target by 65.5%.

## Scope and boundaries

- Define eye center as the midpoint of the two eye corners, in both the image and mesh. Select the visible profile eye by projected eye-corner separation, supporting either profile direction.
- Separate the front lowest chin landmark from the profile anterior chin landmark. Normalize each view using its own corresponding eye-to-chin height.
- Measure fixed, documented MakeHuman source vertices after deformation; never reselect landmarks while fitting. Project those landmarks through the same ratio calculation used for image marks.
- Preserve profile projection direction instead of folding recessed and protruding chins together with an absolute value.
- Preserve the five existing fit controls and their bounds. Report per-metric fit errors and controls at bounds. Do not imply identity reconstruction or broaden parameter ranges to hide remaining error.
- Version the landmark convention for new calibrations. Previously saved geometry remains renderable; old marks must not silently be reused as corrected marks.
- No provider calls, external model downloads, production deployment or character-data writes.

## Verification

1. Reproduce inner-corner and wrong-profile-eye behavior with synthetic landmarks; verify eye midpoints, both profile directions and chin landmark choice.
2. Project a deformed repository mesh into synthetic three-view landmarks, refit it and verify recovered metric error; this exercises the actual mesh, shared measurements and optimizer.
3. Verify calibration compatibility, review/save UI and fit diagnostics using focused frontend tests and typecheck.
4. Re-run the real PNG through the repository automatic function and fitting in Chromium, inspect point overlays and rendered heads, and report remaining per-metric error without comparing scores across different conventions as if they were identical metrics.

## Correspondence and scoring

The installed `@mediapipe/tasks-vision@0.10.8` eye connection constants contain canthi 33/133 and 362/263. Their midpoints define image eye centers; the wider projected corner separation selects the profile's visible eye. Image chin 152 remains the front inferior point; profile 199 is the anterior chin suggestion and still requires visual review.

Fixed hm08 source IDs (zero-based, as stored in `head.json.sourceVertexIds`):

| Feature | Image | MakeHuman source vertices |
|---|---|---|
| Front left/right cheek | 234 / 454 | 269 / 7038 |
| Front left/right jaw | 172 / 397 | 894 / 7596 |
| Front left eye | midpoint 33, 133 | midpoint 70, 86 |
| Front right eye | midpoint 362, 263 | midpoint 6854, 6870 |
| Front lowest chin | 152 | 5225 |
| Profile visible eye | midpoint of visible eye corners | midpoint 6854, 6870 |
| Profile nose tip | 1 | 297 |
| Profile anterior chin | 199 | 5162 |

Mesh vertices are projected orthographically into front `(x, -y)` and left-facing profile `(-z, -y)`. Both use the same measurement function as the image, with actual eye and chin landmark heights. Chin projection retains its sign relative to the nose direction. Positive ratios use log differences; signed chin projection uses `asinh(ratio / 0.1)` differences to remain finite and continuous across zero. The total score is the root mean square of these five differences. It is a proportion score, not identity or surface reconstruction accuracy.

The bounded coordinate search allows up to twelve passes per step and stops early when no coordinate improves. No fit range was expanded. New calibrations carry `landmarkConvention=eye-center-chin-front.v2`; the stored shape schema remains v1. Old geometry and prompts continue to render, but old marks and old review approval cannot authorize a new save. Editing a point also invalidates the fit until it is recomputed.

## Validation result

- Focused automatic-mark and mesh-fit tests: 7 passed, including mirrored profiles, either visible eye, signed/zero chin depth and recovery from a deformed real mesh at image aspect 1.7.
- WhiteFaceModel tests: 13 passed, including legacy geometry preservation and rejection of saving after a reviewed point changes.
- CharacterWorkbench tests: 82 passed. Frontend typecheck passed.
- Real original PNG (1223 × 1286) through repository automatic marking, fitting and WebGL rendering: 10/10 marks. Under the new convention, baseline score 0.123838 and fitted score 0.003215. These are not comparable to the previous convention's score.
- Fitted parameters: cheekWidth 91, jawWidth 90, eyeSpacing 89, noseProjection 110, chinProjection 110. None at fit bounds.
- Fitted relative differences from the new image targets: cheek aspect +0.1551%, jaw ratio -0.0804%, eye ratio +0.0740%, nose projection +0.6566%, chin projection +0.2565%.
- Runtime artifacts remain in `/private/tmp/iframe-face-review/`; original pre-change evidence is retained in `/private/tmp/iframe-face-review-before/`.

Limit: one generated-character sample verifies this path; five fitted proportions do not prove full facial likeness. Fixed chin/contour correspondences and the visible-eye heuristic still need validation across more source faces and nonstandard three-view layouts. No production deployment or online character write was performed.
