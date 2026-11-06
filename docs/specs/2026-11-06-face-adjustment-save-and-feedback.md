# Face adjustment persistence and feedback

## Observed

- WhiteFaceModel exports a library image and calls a synchronous `onSaved`. CharacterWorkbench updates local state only; durable character design saving is a separate action. Thus the face save action alone cannot survive closing the workbench.
- Calibrated prompts omit changes below five control points and reduce every remaining amplitude to the same word. They omit several existing controls entirely. Numeric controls are deformation inputs, not measured physical dimensions or guaranteed image-model outputs.
- Calibrated controls are restricted to 90–110, while the two whole-head views make localized nasal width changes small on screen. Mesh nose bridge height changes depth; bridge/tip width change horizontal coordinates.

## Changes and verification

1. Face save must await durable character design saving, retaining the saved design's other fields. Keep unrelated unsaved edits local. Show success only after persistence; surface failures and retain edits for retry. Verify save/close/reopen and failure behavior through the workbench and component boundary.
2. Preserve exact calibrated control values in prompts, including small edits and all existing controls. Explicitly describe them as controls relative to the fitted baseline, not physical percentages. Verify distinct nasal amplitudes produce distinct prompts and neutral controls stay omitted.
3. Add optional front/profile nasal close-ups for baseline/current comparison without changing geometry coefficients, fit constraints, existing full-head preview or exported view. Verify control direction and unchanged preview export behavior; inspect real mesh close-ups in Chromium.

No image generation or existing character-data overwrite is needed for these checks.

## Verification result

- 104 component/workbench tests and 21 math/image/detection tests passed; TypeScript check passed.
- Chromium 136 loaded the actual component and `autoMarkThreeView` against the original 1024×1024 portrait and 1223×1286 sheet. It returned seven front and three side marks, fitted the mesh, and required review before saving.
- Independent 100→110 changes to bridge height, bridge width and tip width each changed the actual rendered close-ups. Visual inspection confirmed the bridge rise in profile and width changes from the front. This establishes white-model behavior; it does not establish image-generator adherence to the numeric prompt.
- Optional close-ups leave the full-head export canvas unchanged. The browser verification blocked non-GET requests and made no character-data writes.
