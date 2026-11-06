# Independent portrait reference for face fitting

## Problem and scope

The selected Su Yan avatar contains a clear front face (~307 native pixels tall) plus an angled face. The selected full-body sheet contains a true profile (~91 px tall). Previous verification used temporary composites because the product accepted only one three-view image. Add an explicit opt-in to use the currently selected registered headshot as front reference, while retaining the selected sheet for profile. Do not change character asset selections, select historical candidates, infer profile from the angled head, or deploy.

## Contract

- Preserve the existing sheet-only mode and its stored coordinates. Add a front-reference source selector and whole/left/right region selector. The user is responsible for selecting the actual front face. Multiple detected faces in the requested region must produce an actionable error rather than silently choosing one.
- Resolve both inputs through original asset delivery, retaining origin-aware authenticated fetching. No preview URL, external downloads or upscaling enhancement.
- Detect the independent front from its own original pixels, use the existing square crop/padding and final 512-pixel detection requirement, and inverse-map seven front points to that original image. Sheet-only detection remains the same; portrait mode requests only the sheet's three profile points.
- Extend image aspect inputs to either the legacy single number or independent `{front, side}` numbers. Measurements remain within each view; no image composite or cross-image distance is used.
- Persist independent front source identity, scope/container, region, native dimensions and optional crop/preparation alongside the seven front points. Keep the existing calibration source and imagePreparation for the sheet/profile. Never persist preview data URLs.
- Display front marks only on the portrait and profile marks only on the sheet. Allow manual corrections on the appropriate image. Failed front detection must still allow manual marks after source dimensions load.
- Reference selection, region, asset version or scope/container changes invalidate old points, fitting/review and pending detector callbacks. Existing geometry remains visible. Saving a portrait-based fit requires the matching loaded sources, both views' marks, a new fit and user review. Async work finishing after a source change cannot restore stale points or clear a newer busy state.
- Old sheet-only calibrations remain usable under their current method/convention. Old saved portrait sources that no longer match the selected headshot are displayed as stale, never silently rebound.

## Verification

1. Validate separate-aspect metrics against the same physical geometry encoded on images with different dimensions; include mirroring and invalid aspect rejection.
2. Verify independent front inverse mapping, multi-face rejection and final-detection failure without coarse-point substitution.
3. UI tests verify original loaders, region selection, manual correction, per-source point display, independent metadata on save, stale source/region invalidation and discarded asynchronous results. Verify workbench passes only the selected registered headshot and preserves legacy behavior.
4. Run focused math/image/UI/workbench tests and typecheck. Use local Chromium to pass the original selected avatar PNG and original sheet PNG independently to the actual functions, fit with separate aspects and render/inspect returned points and geometry.
5. Commit the feature atomically. No online writes, generation calls, pushes or deployment.

## Verification results

- Focused math/image/detector tests: 20 passed. WhiteFaceModel and CharacterWorkbench UI tests: 102 passed. Typecheck passed.
- Local Chromium 136 against the original selected PNGs: avatar 1024 × 1024, three-view 1223 × 1286. The whole-avatar region reports two faces; selecting left returns seven front points, while the three-view side-only path returns three profile points. Both original sources show their own native dimensions and 512 × 512 crops.
- The actual fitted objective residual on those returned marks was 0.075020 before fitting and 0.003347 after. No fit control reached its bounds. The avatar face is about 307 native pixels high; the profile face is about 91 pixels high and triggers the existing low-detail warning. These metric results do not establish identity likeness; point and mesh review remains required.
- Mounted the actual WhiteFaceModel in local Chromium with original source bytes and local model files. Confirmed ambiguity messaging, seven/three marker separation, review-gated save, and region-change invalidation. All network requests were local GETs; no writes were made.
- Browser artifacts and provenance are in `/private/tmp/iframe-face-independent-verification/` and `/private/tmp/iframe-face-independent-verification/ui/`. The source image hashes match the audited originals.
