# Standard independent front/profile face references

## User contract

Replace region-choice inputs with two independent single-person images: frontal and approximately90° profile, same character, level head and neutral expression. Require both for new calibration. Retain existing numerical geometry when reopening legacy data; never silently reinterpret the old three-view sheet as a profile image. Guide deformation uses only the saved frontal original, always whole-image mode. A 2D frontal guide still cannot synthesize forward bridge projection.

## Sources and processing

Two labelled reference inputs offer local upload; frontal input can explicitly adopt current selected portrait. Validate locally before uploading via existing library upload/create APIs. Persist stable original asset variant locators, image sizes, view role and standardized crop provenance in calibration. No blob/data URLs or detector previews in saved character data. Use owned original delivery with existing auth boundary; reject missing/multiple/too-small/clearly wrong-view detections. Original face height >=128px, recommended256px; crop with20% margin to512×512 without stretching. View classification from model geometry is approximate and must be disclosed; human review of both images/marks is mandatory, no automatic guarantee of same identity or exact90° camera angle.

## Interaction

One front card and one side card; no whole/left/right selector. Invalidate obsolete async work, marks, review and guide when either reference changes. Cancelled/failed loads must not release a newer busy state. Show errors beside their input. Fit only after both views are ready. User may correct detected points; edits invalidate fit review. Save requires matching sources, fit and review. Restore saved geometry and source pair after reopening; source upload alone does not save calibration. Preserve manual base-preset parameter editing without a photo calibration.

## Validation and release

Failing tests for missing profile, duplicate/wrong views, low native detail and old region-choice guide. Test separate aspect ratios and source provenance, cancellation/replacement, single save/reopen, no writes before local image acceptance, failed upload/save, manual mark correction, guide stale-state protection and whole-image-only behavior. Real local browser uses existing Su Yan PNG and isolated profile crop through repository detector/fit, zero online writes or generation. Desktop/mobile keyboard-visible labels, min44px controls and no horizontal overflow. Typecheck, focused tests, production build, sensitive diff scan, PR/CI and existing candidate/merge/deploy flow.

## Verification evidence

- Typecheck and production build passed; focused algorithm/image/fit checks32 and UI/workbench checks112 passed.
- Chromium136 local GET-only run exercised actual `autoMarkFacePhoto` and `fitFaceToLandmarks`: current Su Yan PNG1142×1377 yielded native face height418px; frontal-as-profile rejected; original low-detail sheet profile rejected at90px. An existing enlarged profile fixture exercised the accepted profile/fit path (residual0.004). That fixture proves the function path, not genuine native profile detail or identity fidelity; users need a genuinely detailed profile original.
- At default detection confidence0.5 the profile fixture's crop produced a second face detection over the ear. At0.7 both locating and final stages returned one face, while the frontal/wrong-role/low-detail cases retained their expected behavior. The new photo entry point uses0.7; it still rejects multiple returned faces and does not select one from them. View heuristics are a precheck, not a quality or identity guarantee.
- Real component rendering at1200px and390px restored manually corrected persisted marks and reviewed state, allowed continued edits, invalidated review on slider changes and showed no horizontal overflow. Zero online writes, external requests or browser errors. Restoring validates image dimensions/view but preserves saved original-coordinate manual marks; it never substitutes fresh detector marks.
- Existing frontal guide regression still passed its nasal texture-tracking gate. The current saved mixed large adjustments still trigger the pre-existing fold rejection; reference-format cleanup does not bypass that gate.
