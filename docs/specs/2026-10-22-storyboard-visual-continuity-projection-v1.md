# Storyboard reference visual projection v1

## Goal

When a creator explicitly selects a storyboard frame or scene variant as a
reference for another frame, iFrame offers a reviewable projection of the
reference's structured visual design. The selected image and the structured
projection are separate inputs.

## Defaults and user boundary

- Selecting a reference defaults to **image only**.
- Structured context is never selected from frame order, scene-name
  similarity, prompt similarity, or a missing continuity identifier.
- The creator may explicitly confirm any available subset of these categories:
  `lighting`, `space`, `camera`, and `continuity_state`.
- The projection is built from the selected source asset/variant or source
  frame snapshot. It never copies the source's complete prompt, subject or
  character description, action, performance, dialogue, audio, or transition.
- A generated image variant and its `submission_snapshot.visual_design` form
  one versioned reference. When that snapshot exists, projection reads that
  historical design and `design_revision_at_submission`; later edits to the
  scene's current design do not rewrite the variant's visual context. Current
  continuity IDs may still determine which categories are eligible.
- The target frame's own values win field by field. Empty target fields may be
  filled only by fields the creator confirmed from the selected reference.
- The saved snapshot includes source asset, variant, media, asset/design
  revision, source frame/shot, target frame, selected categories, and the
  projection revision. It is a value snapshot, not a live link.

## Continuity eligibility

- If source and target have confirmed matching `time_continuity_id`, world
  lighting fields may be offered.
- If the time IDs match but the `place_continuity_id` values differ, only
  world-light fields are offered: story time, daylight phase, weather, and
  shadow direction. Local practical/key-light fields, space, camera, and
  blocking are not offered.
- Space, camera, and continuity state are offered only when confirmed place
  and time IDs match.
- Missing or ambiguous continuity IDs do not infer eligibility. The image may
  still be used by itself. The UI may show source-derived fields, but no
  category is suggested or selected until the creator explicitly confirms it.
- If IDs are unresolved, only the creator's explicit per-category choice can
  use the displayed source values; no continuity relationship is inferred.
- If the confirmed plan proves different times, no continuity category can be
  applied.

## Submission and preview

- The preview endpoint compiles the exact prompt from the current target
  prompt plus the confirmed bounded projection.
- The render request must present the matching preview token. A changed source
  variant, source design revision, target frame, or selected category set
  invalidates the token.
- The reference image is submitted through the confirmed
  `StoryboardReferencePackage`; its provenance is retained independently from
  the natural-language prompt.
- The projection snapshot is persisted on the target frame. Canonical image
  fields are not changed when a candidate is generated.

## Acceptance tests

- Image-only selection sends the selected image and no structured clauses.
- A selected subset sends only those categories.
- The source's action, dialogue, character/subject description, and complete
  prompt do not appear in the compiled or submitted prompt.
- Same-time/different-place carries world light only.
- Same-place/same-time can carry space, camera, and continuity state.
- Missing continuity IDs never auto-project a category.
- Target fields override confirmed reference fields.
- Cross-scene references retain source asset/variant/media and revision data.
- A variant with a structured submission snapshot keeps its original design
  after the scene's current design revision changes.
- Preview text equals the text submitted to the provider; stale snapshots are
  rejected.

## Variant snapshot cutover

Code audit on 2026-10-22 found that a selected variant without
`submission_snapshot.visual_design` can currently borrow the scene's latest
design or a frame's current shooting state. That state is not evidence of what
was used to create the selected image.

For scene and frame variants, an absent visual snapshot means the structured
version is unknown: offer the image, leave structured categories unavailable,
and do not report the current scene design revision as the image's revision.
New storyboard frame renders must freeze their allowlisted lighting, space,
camera and continuity state on every new image variant. Legacy variants remain
unchanged. The render and batch paths must preserve existing variants and
record a snapshot only for newly generated ones. A confirmed variant snapshot
is read without merging later scene or frame edits; continuity stage entries
remain limited to exact target entity references.
Frame variant snapshots also freeze the source scene ID and the explicit place,
time and shooting-plan identity used for eligibility. Later plan edits do not
retroactively change the source image's scope. Missing IDs stay unresolved.
