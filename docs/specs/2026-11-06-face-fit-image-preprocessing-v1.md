# Face fitting image preprocessing v1

## Problem and scope

The current source may be a full-body three-view image. Resizing its entire column leaves few face pixels and gives inconsistent detector input dimensions. Define a standard working image for each face, while retaining the original reference and all saved landmarks in original-image coordinates.

## Image contract

- Input: decoded browser image from the existing original-asset delivery path; front, profile, back arranged left to right. The current automatic layout ranges remain front 0–34%, profile 35–66%. Nonstandard layouts require manual marks; this change does not claim to detect arbitrary panel arrangements.
- Recommended delivery: head-only three-view sheet 3072 × 1024, three 1024 × 1024 cells. PNG/JPEG/WebP may be decoded by the existing browser image loader. These are recommended source dimensions, not a rejection rule for existing full-body sheets; native face detail remains the quality criterion.
- Preferred source: front and true profile of the same character, neutral expression, level head, clear eyes/nose/chin, no beauty filters or geometric edits. Each source face should have at least 256 native pixels from forehead to chin; below 128 pixels is flagged as insufficient detail. Upscaling does not count as new detail. The dimensions of the whole three-view sheet alone do not establish face resolution.
- Working image: independent 512 × 512 RGB canvas for front and profile. Fit the detected face bounds plus 20% margin on each side into a square in source-pixel space. Preserve aspect ratio, use a neutral background outside image boundaries, and high-quality resampling. Never stretch a face to match a square or perform generative restoration/beautification.
- Pipeline: bounded coarse head localization → map coarse detection to original coordinates → square crop with margins from original pixels → 512 × 512 resample → final landmark detection → inverse-map marks to original coordinates → human review → fit. Whole-column coarse localization remains available for head-close-up sheets. A failed final detection must not silently use coarse marks as if preprocessing succeeded.
- Display processed face previews, source face height, and low-resolution guidance before fitting. A low-resolution source may still be manually reviewed, but the UI must not imply normalization recovered detail.
- Persist preprocessing version and crop/source dimensions with a new fit when available, without storing preview data URLs. Keep old geometry and landmark convention compatibility.

## Verification

- Test inverse transforms for non-square originals, off-image square padding and both views; source geometry ratios must survive crop/scale/inverse mapping.
- Exercise the actual automatic pipeline with a controlled detector to verify final marks originate from the processed crop and final detection failure leaves that view unmarked.
- Test UI previews and low-resolution guidance, cleanup on source changes and metadata persistence.
- Re-run the real Su Yan original PNG through the repository function in Chromium. Inspect 512 × 512 previews, native face height, original-coordinate overlays and per-metric fit output.
- Focused tests, workbench compatibility tests and frontend typecheck must pass. No production character-data writes or deployment.

## Implementation and local observations

- The UI shows the delivery specification, processed face previews, approximate original face height and missing-detail guidance. Preview bitmaps stay in browser memory; saved calibration provenance contains the preprocessing version, original dimensions, crop rectangles, estimated face height and detection outcome.
- Every detection input is 512 × 512. Initial locating uses uniform scaling with letterbox padding; cropping is restricted to the requested column so adjacent views cannot enter the coarse detector image. Final face crops use source pixels directly and preserve aspect ratio, including padding when a square extends past the image border.
- If an upper-region candidate cannot be detected after standardization, locating retries the full column. This supports head-only sheets without accepting coarse marks as final marks. Fitting/saving are disabled during processing, and previous marks/review approval are cleared before a fresh run.
- Original Su Yan PNG, 1223 × 1286: both final images 512 × 512, 10/10 original-coordinate marks. Approximate original face heights 98.51 / 90.97 pixels: both should trigger insufficient-detail guidance. New fit residual 0.002526, five ratio differences below 0.5%, no control at a bound. These measure internal proportion agreement, not recovered source detail or identity likeness.
- A 3072 × 1024 head-sheet layout constructed from crops of the same original also returned 10/10 points and final detections for both faces. This artificially enlarged sample verifies layout handling only; it is not evidence of high-resolution source detail.
- Tests cover geometry preservation through inverse mapping, padded/column-safe rendering, final-stage detection, missing final results, head-sheet relocation, preview warnings, metadata persistence and source switching. Existing character workbench tests remain applicable.
- Verification passed: 12 automatic-mark/image/mesh-fit tests, 15 WhiteFaceModel tests, 82 CharacterWorkbench tests, frontend typecheck and diff whitespace check.
- Browser artifacts: `/private/tmp/iframe-face-review/` (original source) and `/private/tmp/iframe-face-review-head-layout/` (layout sample). Preprocessing-free evidence remains in `/private/tmp/iframe-face-review-before-preprocessing/`.
