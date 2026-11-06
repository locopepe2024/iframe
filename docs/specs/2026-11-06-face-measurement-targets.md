# Defined face measurements and image targets

## Problem and contract

White-model deformation inputs are not measured anatomical percentages. `faceLength=90` scales source y coordinates by 0.96, rather than producing 90% of the reference face length. Image instructions must give an anatomical measurement, an explicit reference baseline and a target derived from actual deformation.

Existing reference marks include eye centers and chin, not a hairline. Define the current length measure as the vertical distance from the eye-center line to the lowest chin point; do not relabel it as hairline-to-chin length. Define each other distance by its own fixed anatomical endpoints and view. Angles use a signed change in degrees relative to the reference angle, avoiding division by a neutral zero angle.

## Implementation

- Share the existing deformation equations between the rendered mesh and measurements. Freeze measurement landmarks to reviewed MakeHuman source vertices; verify the compact source coordinates against the shipped model.
- Compare the same endpoints before/after deformation. For each length, normalize the corresponding reference-image distance to 100 and write the measured target/baseline ratio as the image-editing target. These are relative editing targets transferred from the white model; they are not claims of pixel measurements or exact reconstruction of unmarked anatomy in the photo.
- A fitted shape uses its frozen fitted baseline. A shape without calibration uses the selected face-preset baseline (neutral for the default preset) and labels that measurement origin in the editor. Never present an internal slider value as a measured length percentage.
- Keep exact controls and saved geometry unchanged. Expose definitions/reference/targets beside the controls; compile the same defined targets into the panel and AI image prompts. Preserve neutral/no-edit behavior, authored descriptions and reference selection.
- Existing optional reference marks remain compatible; no fabricated hairline or automatic character-data migration.
- Reference-relative measured instructions require reference generation with an actual image. Submission review explains the missing baseline when text-only generation or an empty reference set is selected; the white-model export is still excluded from image inputs.

## Verification

Reproduce the incorrect raw 90% prompt first. Test that the length target is 96 for the isolated neutral length edit, the fitted baseline uses its actual geometry, combined controls use final measured geometry, zero angles stay finite and unchanged measurements are omitted. Verify measurement anchor/deformation parity against the complete mesh, exact save/reopen control preservation, prompt application and generation submission. Run focused math/UI tests and TypeScript validation, then the existing PR/CI/release workflow.

## Evidence

- The raw-control reproduction failed before implementation and passes with a defined eye-line-to-chin target of 96 for a neutral `faceLength=90` edit.
- 57 neutral, preset, individual-control, combined-control and fitted shapes produce identical vertex positions before/after extracting the shared deformation equations (4,154 vertices per case).
- Compact measurement anchors match the shipped model's source vertices. Front/profile/detail inspection checks their anatomical intervals; fixed eye/cheek/jaw/chin anchors retain the existing fitting convention.
- 106 component/workbench tests and 26 measurement/fitting/prompt tests pass. A measurement-table test confirms that slider 90 remains saved as 90 while the displayed image target is 96.
- Chromium 136 ran the real component with the original Su Yan 1024×1024 PNG and 1223×1286 sheet, fitted seven front and three profile marks, and displayed a fitted length target of 96.02 for control 90. No character-data writes or image-generation jobs were submitted.
- The normalization defines each corresponding reference distance as 100. It transfers measured white-model changes onto that reference interval; it does not claim to have measured every unmarked photo feature or prove image-generator execution accuracy.
