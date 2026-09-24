# Character face design template v1

Status: implementation slice
Date: 2026-09-24

## Observed

- `CastWorkbenchModal` already owns character template selection and builds the
  prompt sent to the existing `reference_sheet` generation path.
- The face design template and quick tag exist, but template cards still use a
  single flex row and do not expose selection through `aria-pressed`.
- Existing variant generation, selection, favorite, deletion, and storyboard
  reference flows are independent of the template card presentation.

## Scope

1. Keep the face design board prompt explicit about four head angles (front,
   left-front 45°, right-front 45°, side), four expressions (natural, smile,
   serious, surprised), and identity consistency for face shape, facial feature
   proportions, skin tone, hairstyle, and age.
2. Provide complete Chinese and English labels/descriptions for the face board
   and the `faceDesign` quick tag.
3. Render template cards with a responsive grid and expose their selected state
   via `aria-pressed`.
4. Add component coverage for the prompt, bilingual copy, responsive card
   state, and preservation of the existing reference-sheet request type.

## Boundaries

- Do not change asset polling, `reference_sheet` variant storage, selection,
  favorite, deletion, library reference, or storyboard reference contracts.
- Do not add a new API field or generation mode.

## Success criteria

- Selecting the face design card updates the editable prompt with all required
  angles, expressions, and consistency constraints.
- The Chinese and English UI expose the face board description and quick tag.
- Cards remain usable at narrow widths and expose exactly one pressed card.
- Existing component tests continue to prove `reference_sheet` generation and
  variant operations use their current API arguments.

## Verification

```bash
cd frontend
npm run test:ui -- src/components/modules/cast/CastWorkbenchModal.test.tsx
npm run typecheck
```
