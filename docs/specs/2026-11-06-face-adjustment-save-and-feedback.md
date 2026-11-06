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
