# Nose support in the frontal face guide

## Problem

The first local guide only moves face/eye/contour controls. Changing saved nose width or height controls can leave the guide's nose unchanged; an omitted-target disclosure does not make those controls effective. The guide also reads saved controls, while sliders hold an unsaved local draft.

## Contract

- Add explicit frontal landmark constraints for nose bridge width, nose tip width, nostril/alar width and vertical nose-tip position. Derive ratios and signed displacement from the same baseline/current mesh measurements used by the white model. Do not interpret slider values as length percentages.
- Bridge, tip and alar intervals use reviewed MediaPipe image landmarks. Each maps the white-model interval's relative edit onto its corresponding photographic region; these are approximate anatomical correspondences, not full 3D reconstruction.
- Verify nasal pixel correspondences by tracking original texture patches in the output, independent of inverse resampling. Widths relative to cheek width retain the 5% relative tolerance; vertical tip displacement retains the 1 unit tolerance (original eye-to-chin length = 100). Require source patch variance >= 1, normalized texture error <= .25 and localization residual <= .8 px for every nasal point. Reject insufficient texture or unreliable correspondence. This verifies projected 2D pixel edits, not actual anatomical dimensions or 3D reconstruction.
- Keep independent MediaPipe output checks for face length, jaw width and eye spacing, with the existing 5% gate and six original-pixel correction attempts. Nasal detector estimates are shown separately and never repeatedly drive nasal correction. Keep mouth control points at the contour-only positions, retain local eye shape, and reject folded maps.
- Nose bridge height means forward elevation in profile, not upward motion in the frontal image. Nose projection and bridge height remain unsupported by this 2D guide. Display changed unsupported depth targets above the preview action, and reject a depth-only request before image detection instead of returning a successful unchanged guide.
- Show that the guide uses saved controls; if the white-model draft differs, disable preview/application until it is saved. Keep original geometry and save behavior unchanged.
- Expose a nasal crop comparison and target/output rows. The refinement prompt preserves the already-adjusted nasal geometry. No hidden second application of original percentages.

## Verification

Reproduce width-only input leaving nasal control/pixels unchanged. Test bridge/tip/alar widening and narrowing, nasal vertical movement, neutral pixel identity, unsupported depth-only rejection and unsaved-state blocking. Chromium uses Su Yan's local original PNG through the real detector, pixel deformation and output re-detection, with zero online writes/generation. Test UI/workbench paths and typecheck/build before the existing PR/CI/release flow. Confirmed local geometry does not prove model refinement adherence.

## Detector boundary and implementation decision

Runtime observation on Su Yan's 1190×1322 portrait (native face height 501 px): repeated pointwise and regional nasal correction changed visible pixels substantially, but MediaPipe's bridge-width estimate stayed around 98–102 against measured targets 88.24/111.76. Six corrections exaggerated the nose. This makes these inferred dense nose intervals unsuitable as pixel-edit truth; it does not establish the cause inside the learned model. The working hypothesis is a strong nasal shape prior.

The final path applies one smooth regional nasal target, anchoring surrounding nose texture and the mouth. Contour corrections may continue from original pixels, with nasal controls fixed. A separate patch search locates source texture in the actual output, including the old location when within its search radius, so an unchanged render cannot pass a material displacement. Texture checking uses local affine patch orientation and subpixel search. It cannot establish photorealism, identity retention, accurate nose anatomy, or image-model adherence; manual enlarged review remains required. Tests reject unchanged, flat and corrupt pixels rather than just checking control mappings.

## Local verification results

Chromium 136, actual repository detector/deformation/UI, loopback GET only, no product data writes or image generation. Individual controls 90 and 110 on the neutral baseline all pass. Nasal widths below are tracked pixel intervals relative to detected cheek width, original = 100:

| Edit | Target | Output |
| --- | ---: | ---: |
| Bridge width 90 | 88.24 | 90.26 |
| Bridge width 110 | 111.76 | 109.89 |
| Tip width 90 | 93.09 | 93.81 |
| Tip width 110 | 106.91 | 106.34 |
| Alar width 90 | 94.62 | 94.52 |
| Alar width 110 | 105.38 | 105.06 |
| Tip vertical 90 | +4.53 units | +4.26 units |
| Tip vertical 110 | -4.53 units | -4.69 units |

All four nasal controls at 110 together also pass in the real component. Desktop and 390 px mobile display matching nasal crops, prevent application before review, and invalidate old output after source-region changes. No page errors, external requests or writes occurred.

The saved legacy combination (faceLength90 / faceWidth120 / cheekWidth117 / jawWidth75 / eyeSpacing80 / noseProjection75) plus four nasal controls110 remains rejected: nasal pixel checks are within tolerance, but jaw/cheek target86.33 vs91.57 exceeds the unchanged5% contour gate. Do not claim success or silently relax that gate. More than six corrections led to folding in this example, so the existing six-attempt limit remains.
