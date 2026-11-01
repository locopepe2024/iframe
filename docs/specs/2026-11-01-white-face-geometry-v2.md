# White face geometry v2

## Observed

- The current browser white model stores six normalized geometry values and renders a simple front/side proxy.
- Saved designs already persist `white_face_shape` as JSON and pass a text summary into character prompts.
- The current shape values are global proportions; they do not distinguish nose, lips, chin, eye form, or brow spacing.

## Direct implication

The next slice can extend the existing JSON shape without changing the image-generation API. Old records remain valid by filling missing fields from a neutral value of `100`.

## Scope

- Add grouped controls for head outline, nose, eyes/brows, and mouth/chin.
- Keep `100%` as the neutral baseline and preserve the six existing keys.
- Render the new values in the browser proxy where a low-risk geometric approximation exists.
- Include all normalized values in the saved prompt summary.
- Keep the white model as geometry-only metadata; its image remains excluded from generation references.

## Boundaries

- No FaceVerse, FLAME, Basel Face Model, or external model download in this slice.
- No claim that browser primitives reproduce anatomical faces accurately.
- No change to ordinary character reference-image semantics.

## Success criteria

- Existing saved six-field records reopen without `undefined` values.
- New fields round-trip through save/reopen and appear once in the prompt summary.
- White-model image remains excluded from image-generation references.
- Existing CharacterWorkbench and WhiteFaceModel tests remain green.
