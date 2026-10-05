# Character identity Skill v1

## Status and evidence

- Code fact: the canonical `CharacterWorkbench` currently offers identity, look, and continuity facets and preserves accepted facet IDs with character data.
- Code fact: the image editor accepts ordered reference images and an editable prompt, but has no template library yet.
- Decision: future visual design templates belong to the image editor. Existing character facet data remains readable; this document does not authorize a schema migration.

## Ownership

The character workbench resolves the correct person, era, and look for a scene, reviews identity anchors and continuity, and exposes confirmed character references to Storyboard. Its existing facet controls remain compatible with saved projects, but new appearance, expression, action, style, and effect templates are not added there.

The image editor owns optional templates and Skill suggestions for generating visual candidates. A suggestion becomes editable prompt text only after the user selects it. Generating a candidate does not update character identity, a confirmed look, Director interpretation, or the shooting plan. Adoption and the destination of the media are separate user actions.

The `character-identity-design` Skill may provide identity and continuity review guidance. Its legacy `workbench_facets` remain supported for old character records and the canonical workbench; they are not the contract for the new template library. Skill instructions must not be submitted verbatim as provider prompt text.

## Boundaries

- Skills and templates do not select a model, SKU, ratio, size, or generation mode.
- Scene-specific clothing, gaze, expression, action, camera, style, and effects are image editor draft inputs, not permanent identity facts.
- Director's raw `story_map`, `canon_state`, fact ledger, and internal metadata are never appended to image prompts. Only projected, relevant visual constraints may be used.
- A generated scene image can be referenced directly by Storyboard. Saving it into a global asset library requires an explicit user action.

## Success criteria

1. Both Cast and asset-library character entries render the same `CharacterWorkbench`.
2. No second Cast character facet implementation loads Skills or modifies prompts.
3. Existing facet IDs and character candidates remain readable without migration.
4. Future image editor templates produce editable drafts and have explicit adoption semantics.

## Verification

- `npm run typecheck`
- `npm run test:ui -- --run src/components/modules/CharacterWorkbench.test.tsx src/components/modules/cast/CharacterWorkbenchBridge.test.tsx src/components/modules/cast/CastWorkbenchModal.test.tsx`
- `npm run build`
