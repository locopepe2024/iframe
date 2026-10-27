# R2V scene reference lighting review

## Scope

When an R2V shot explicitly references a scene asset, the polish review uses the
selected image variant's frozen structured lighting. A scene image generated
from another scene variant may inherit that exact variant's structured lighting
tool. Asset names, nearby shots, and later edits to the scene design are not
lighting sources.

## Decision

- Image attachment remains explicit. A referenced scene slot resolves to one
  selected image variant unless the shot selected a different valid variant.
- Extract only lighting fields from `submission_snapshot.visual_design` and the
  exact referenced variant's `scene_tool` when it is a lighting tool. Do not
  copy prompts, people, actions, dialogue, or sound from either scene.
- Offer this local-light candidate only when the shot's explicit `scene_id`
  matches the referenced scene asset. A mention of another place does not
  transfer its local key light; other continuity categories stay in their
  separate review flow.
- If both reference lighting and shot lighting are present, the polish review
  requires a choice: keep shot lighting or use reference lighting. No semantic
  comparison of free text may silently decide that the values agree.
- The chosen lighting and its asset/variant lineage are included in the review
  token and the confirmed model input. A changed source invalidates the review.
- Missing structured lighting is shown as unavailable. The image can still be
  used, but no structured lighting is invented from its appearance or prompt.

## Acceptance

1. A selected scene variant with a frozen lighting tool produces a bounded
   lighting candidate, including an exact parent variant when referenced.
2. A shot with its own lighting cannot confirm R2V polish until the creator
   chooses the source; the model receives only the selected priority.
3. A variant lacking structured lighting sends its image without a fabricated
   lighting candidate. Revisions and selections are rechecked at confirmation.
