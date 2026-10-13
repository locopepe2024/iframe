# Character identity Skill v1

## Status and evidence

- Code fact: the canonical `CharacterWorkbench` currently offers identity, look, and continuity facets and preserves accepted facet IDs with character data.
- Code fact: the image editor accepts ordered reference images and an editable prompt, but has no template library yet.
- Decision: future visual design templates belong to the image editor. Existing character facet data remains readable; this document does not authorize a schema migration.

## Ownership

The character workbench resolves the correct person, era, and look for a scene, reviews identity anchors and continuity, and exposes confirmed character references to Storyboard. Its existing facet controls remain compatible with saved projects, but new appearance, expression, action, style, and effect templates are not added there.

The image editor owns optional templates and Skill suggestions for generating visual candidates. A suggestion becomes editable prompt text only after the user selects it. Generating a candidate does not update character identity, a confirmed look, Director interpretation, or the shooting plan. Adoption and the destination of the media are separate user actions.

`character-identity-design` is an owner-installable Skill with two surfaces:

1. `instructions`: guidance for an Agent or future prompt assistant;
2. `workbench_facets`: legacy bilingual topic labels; they are not completed visual-design values.

Current design decision (2026-10-12): the project character workbench invokes the Skill with the character profile, current style, confirmed project design and selected reference assets. It presents concrete identity/look text and only essential review questions. A user can apply the editable draft to the current image prompts without saving an asset or design revision. Confirmation separately saves the project character design revision. The independent Avatar entry is outside this workflow. Generic facets are not appended to provider prompts.

## Boundaries

- Skills and templates do not select a model, SKU, ratio, size, or generation mode.
- Scene-specific clothing, gaze, expression, action, camera, style, and effects are image editor draft inputs, not permanent identity facts.
- Director's raw `story_map`, `canon_state`, fact ledger, and internal metadata are never appended to image prompts. Only projected, relevant visual constraints may be used.
- A generated scene image can be referenced directly by Storyboard. Saving it into a global asset library requires an explicit user action.

## Success criteria

- The catalog exposes the Skill with a content-addressed revision and structured facets.
- An enabled Skill appears in the character workbench only; scenes and props do not show character facets.
- A Skill result separates script evidence, creative choices and essential review questions; an unconfirmed candidate enters a current image prompt only through the explicit draft application action.
- Existing generation and image-editor flows remain unchanged.

## Verification

- `npm run typecheck`
- `npm run test:ui -- --run src/components/modules/CharacterWorkbench.test.tsx src/components/modules/cast/CharacterWorkbenchBridge.test.tsx src/components/modules/cast/CastWorkbenchModal.test.tsx`
- `npm run build`
