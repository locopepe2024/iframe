# Storyboard Product Multi-Reference V1

Status: extended implementation in progress.

## Observed

- `ImageAsset.variants` already stores multiple images for one prop/product.
- `selected_id` identifies one primary image used by thumbnails and current
  Storyboard reference submission.
- Storyboard generation currently resolves every `[characterN:name]` slot to
  one URL, so additional product variants do not reach H3.
- Generated-audio is submitted from the visible parameter value, but the value
  is shared across shots and is not persisted on `StoryboardFrame`.

## Direct Implication

Multiple stored variants do not currently provide multi-angle conditioning.
The generation request needs a persisted, per-shot selection of variant IDs and
an explicit mapping that tells H3 those pictures depict one physical subject.

The generated-audio choice must be stored per shot. Submission precedence is:

1. the shot's explicit persisted choice;
2. the current project/UI default for a legacy shot without a choice;
3. `false` when neither exists.

## Product Contract

- One product remains one semantic asset with one stable `asset_id`.
- Its image variants may optionally describe view role and distance.
- `selected_id` remains the primary thumbnail/default reference.
- A shot may select multiple variant IDs from one product asset.
- H3 receives each selected variant as a separate `<Picture N>` in stable order.
- The prompt maps all of those pictures to one `<Subject N>` and states that
  they are views of the same physical product.
- A shot with no explicit multi-selection continues to submit the primary image.
- Distance and angle are child-reference metadata, not separate semantic assets:
  `穿心莲` owns `远景 / 中景 / 近景` or `正面 / 侧面 / 斜侧面` views.
- The asset chip inserts the stable semantic reference. Its adjacent view control
  selects one or more child references for that shot without changing the prompt
  asset name.
- Cast revisions/reference images are deletable. Deleting the primary view
  promotes another remaining view, or clears the primary when none remain.
- Deletion removes the variant ID from every frame in the current project so a
  later paid request cannot retain a stale view selection.
- All selected child views across all referenced assets share H3's nine-picture
  request budget; the UI must reject a selection that would exceed it.

Optional variant metadata:

- `reference_view_role`: front, left, right, back, top, bottom,
  three_quarter_left, three_quarter_right, or detail.
- `reference_distance`: macro, close, medium, or full.
- `camera_yaw` and `camera_pitch`: descriptive degrees when known.

## Prompt Boundary

Prompt constraints should preserve package geometry, logo placement, printed
layout, colors, planar perspective, and readable front-facing typography. They
cannot supply unseen side-panel information and do not guarantee pixel-perfect
text during rotation or motion blur.

For exact hero-pack typography, generated motion should limit yaw/pitch and
speed. Post-generation planar tracking/compositing remains the deterministic
fallback when exact printed pixels are mandatory.

## Success Criteria

- Audio on/off survives refresh independently for each shot and the submitted
  `generate_audio` equals the user's shot choice.
- One product with three selected variants submits three URLs in stable order.
- H3 prompt binding maps those pictures to one subject without shifting later
  assets' picture indices.
- Existing one-image assets and old frames require no migration.
- Invalid or foreign variant IDs are ignored or rejected before paid generation.
- Character canonical `reference_sheet`, scene and prop revisions can be deleted
  from Cast, including series/global shared assets, and persist to their owner.
- Shot quick actions expose child views and reflect the shot's persisted selection.

## Affected Paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/api.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/reference_prompt.py`
- `frontend/src/lib/api.ts`
- `frontend/src/store/projectStore.ts`
- `frontend/src/components/modules/StoryboardR2V.tsx`
- `frontend/src/components/modules/storyboard-r2v/*`
- focused backend and UI tests

## Evidence Limit

Passing request-capture tests proves ordering, persistence, and prompt mapping.
It does not prove visual text fidelity. That requires controlled H3 A/B renders
using the same prompt and seed/config once the provider exposes deterministic
seed support.
