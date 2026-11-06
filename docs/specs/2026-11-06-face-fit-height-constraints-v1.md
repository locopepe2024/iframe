# Face fitting with landmark height constraints

## Evidence and goal

The selected Su Yan avatar and original profile return ten marks through the repository detector. After fitting five ratios and aligning by eye position and eye-to-chin height, cheek landmarks still differ by 16.9–18.2 native pixels, jaws by 9.6–10.7 pixels, and the profile nose by 4.39 pixels. The existing five controls change only x/z coordinates: no objective can correct the missing y motion with those controls alone.

A temporary prototype fitted three additional normalized heights using smooth, bounded vertical deformations. On the same frozen marks, cheek distances became 0.05–1.54 pixels, jaw distances 0.46–1.28 pixels, and nose distance 0.08 pixels, without bounds. These are observations for one generated character, not identity accuracy or detector ground truth.

## Implementation

- Add cheekHeight, jawHeight and noseTipHeight controls, default 100, bounded 75–125 during fitting. Positive values raise the region in mesh space. Use fixed source-coordinate Gaussian weights for both cheek and jaw regions, and the existing nose-tip weight. Do not reselect landmark vertices.
- Add three signed metrics: average cheek and jaw height relative to front eyes, divided by front eye-to-lowest-chin height; nose height relative to profile eye, divided by profile eye-to-anterior-chin height. Differences are linear in those normalized coordinates. Preserve log/asinh scoring for the five existing ratios.
- Report all eight terms; RMS uses their actual count. Version the objective as `ratios-and-heights.v1`. The landmark convention stays `eye-center-chin-front.v2` because point definitions are unchanged. Scores from different objectives are not comparable.
- Existing shapes missing new controls use 100. Existing calibration baselines missing just the three newly introduced fields also use 100, preserving old geometry. Existing points with the same source and landmark convention can be reused for refitting; old objective/review metadata cannot authorize a new save.
- Expose the new controls and height diagnostics in the existing panel. Keep user review, bounds and low-resolution notices. Preserve the original image loader and selected three-view source. Independent avatar-source product support is a separate change.
- No production writes, asset selection changes, deployments, provider calls or downloads. Temporary character images and diagnostic artifacts remain in `/private/tmp`.

## Verification

1. A regression fixture from a deformed real mesh changes only regional heights; its five old ratios are nearly unchanged. Recover height metrics and preserve the existing ratios. Verify signed heights, non-square image aspect and mirrored profile behavior.
2. Verify default and legacy calibrated geometry remains identical, finite and neutral for missing new controls, and deformation does not move the back of the head.
3. Verify method metadata on save, rejection of old method review, and fresh review after refit/point edits. Run focused math/image/UI/workbench tests and typecheck.
4. Fit the frozen seven crop cases using production source and compare actual point projections before/after. Re-run the selected composite and original PNG through the actual detector/fitter in local Chromium and inspect WebGL output.
5. Review source diff and commit this feature atomically. No push/deploy is part of this change.

## Validation result

- 16 math/image/automatic-mark tests, 16 WhiteFaceModel tests and 82 CharacterWorkbench tests passed (114 total). Typecheck passed. Compatibility tests cover old baselines missing height fields, unchanged rear geometry, and old objective reviews requiring refit.
- Seven frozen detection cases refitted through production source without hitting bounds. Maximum relative error across the original five ratios: 1.14%; maximum absolute normalized height difference: 0.00357. The detector's crop sensitivity remains; this feature corrects fitting, not detection.
- On the same selected-avatar marks, source-pixel cheek distances changed from 18.247/16.868 to 1.542/0.047; jaw distances from 10.690/9.576 to 1.276/0.460; profile nose distance from 4.390 to 0.080. Alignment uses only per-view eye position and uniform eye-to-chin scale; anchor points are not independent validation.
- Local Chromium 136.0.7103.25 re-ran both the original PNG and temporary avatar/profile composite through repository detection, fitting and WebGL rendering: 10/10 marks each, no page errors or bounds. The composite exactly reproduced the frozen sample's marks and new fitted shape.
- Within the new eight-term objective, neutral-to-fitted scores were 0.099610 → 0.004027 for the selected-avatar composite and 0.075519 → 0.003537 for the original sheet. These scores are not compared numerically with the old five-term objective.
- Runtime artifacts: `/private/tmp/iframe-face-height-verification/`, including an image of before/after correspondences and full source/point provenance. Native source faces remain about 307 px front and 91 px profile; independent avatar-source product support and full facial likeness are unverified by this change.
