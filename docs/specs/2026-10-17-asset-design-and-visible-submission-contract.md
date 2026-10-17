# Asset design and visible submission contract

## Scope and evidence

This contract covers character, scene, and prop image generation in Studio asset workbenches. Current code has a versioned character design, but scene/prop `asset_design` submissions are ignored because those models have no matching field. Scene/prop and legacy workbench generation paths also differ in how they append style or default composition. These are code observations; provider output adherence requires runtime checks.

## Ownership

1. **Asset identity/design** is the reusable, editable source for stable appearance. A character owns identity and look; a scene owns spatial layout, architecture, fixed materials and landmarks; a prop owns silhouette, construction, material and recognizable details. Drafts and confirmed revisions are distinct. A script fact and a creative design choice must retain their provenance.
2. **Frame content** describes the image being generated now: actors, action, staging, framing, weather and local light. A shooting-plan entry such as "bandits surround the shop" is candidate frame content, not an invariant of the shop asset.
3. **Continuity references** name the exact preceding/related asset variant and the applicable place, story-time, lighting or object state. The user selects which references to use. The location/time baseline may be shown for review even when it conflicts with a selected image; it does not override that image automatically.
4. **Submission snapshot** contains the complete positive prompt, separate negative prompt, explicit reference identities, model, aspect ratio and the source design revision. Every content-affecting instruction must be visible and editable before submission. A renderer must not append hidden prose after submission. Reference image bytes and provider parameters may be transported separately, but their identity and values must be visible in the review UI.

## Projection and revision rules

- An AI design draft can suggest asset design; it cannot silently change the asset description or final prompt. The user confirms a design revision separately.
- Projecting design, frame content and continuity into a prompt creates an editable snapshot. Later edits to a source do not rewrite an already reviewed snapshot. The UI marks the snapshot stale and offers an explicit rebuild.
- The submitted text is the reviewed snapshot. A saved design, shooting plan, global style, negative preset or legacy template does not gain authority to append text during execution.
- Scene and prop draft confirmation must survive save/reload and create a revision only on confirmation. Unknown design fields must be rejected instead of returning apparent success.

## Initial implementation slice

- Persist scene/prop design drafts and confirmed revisions with validation and a reload regression test.
- Keep the current scene workbench's reviewed prompt and explicit references as the generation input; do not inject the confirmed design or shooting plan into the request behind the UI.
- Audit and then migrate legacy character and asset library workbenches that still opt into backend style/default-composition appends. Their UI and runtime must change together so toggles do not promise an effect that is no longer sent.

## Acceptance criteria

1. Scene/prop design confirmation round-trips through storage with a monotonically increasing confirmed revision.
2. A rejected or unknown design payload does not report successful confirmation.
3. In every migrated image-generation entry, the positive and negative text seen before submission equal the text passed to the provider, apart from documented provider-side transformations outside iFrame's control.
4. Reference identities, model and aspect ratio remain visible in the same preflight review.
