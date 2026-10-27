# Shot field optimization and continuity V1

## Scope

The existing shot controls remain authoritative: duration, shot size, camera angle, camera movement, transition, and shot style/lighting. The model may propose field changes, with one rationale and source list per changed field. Generation reads accepted values only. Seed and narrative/action rewriting are out of scope.

## Effective values

- Duration, size, angle, movement, and transition come from the current shot; confirmed shooting-plan values are suggestions where the shot is empty. A reference image does not silently replace a shot choice.
- Style order: explicit shot override, confirmed bound-scene design style, project style. An unconfirmed scene draft is never an effective source.
- Lighting order: explicit shot override, confirmed scene design and confirmed plan baseline, then only the eligible fields explicitly selected from a versioned reference. Shot lighting fields outrank inherited fields. Missing place/time continuity IDs do not imply a match.
- Show the effective value and source beside the existing controls. Empty override means inheritance, not an empty effective value. Missing values display as unconfirmed.
- The selected image and selected structured fields remain separate. An image variant without a saved visual-design snapshot cannot supply historical structured values.

## AI boundary

- The model input includes only the current shot's action and accepted field values, the effective style/lighting with provenance, and confirmed continuity. It does not include adjacent action, dialogue or character descriptions.
- A proposal cannot change action, asset identity, reference selection, or media. Each changed field needs a nonempty rationale and input field references. No field is applied before review.
- The target model adapter reads accepted fields; H3 and Seedance formatting is a later step. The video submission preview must display the actual compiled style/light, camera fields, duration and references. An accepted full prompt becomes stale when a dependent field changes and requires renewed review.

## Acceptance

1. A bound scene with a confirmed style and light design supplies those values when the shot has no override; the source revision is visible.
2. An explicit shot override wins. Clearing it restores inheritance.
3. Same time but different place permits world light only; same place/time permits selected local light and space/camera; unresolved IDs do not infer either.
4. Image-only references add no structured clauses. Source actions, dialogue and character descriptions never enter field optimization.
5. Proposed changes are reviewable and stale proposals fail after source edits; accepted fields appear in both optimization input and submission preview.
6. The result is evaluated from exact request text and submitted media, not inferred from the presence of a field in storage.
