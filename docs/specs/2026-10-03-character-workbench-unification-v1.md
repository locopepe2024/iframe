# Character Workbench Unification v1

## Decision

`CharacterWorkbench` is the single character editing and generation UI. The asset library already renders it. The Cast workflow must route character opens through an adapter that renders the same component; Cast keeps its existing `CastWorkbenchModal` only for scenes and props.

## Boundaries

- Character identity, episode look references, continuity facets, existing prompts, uploads and generation actions remain in `CharacterWorkbench` for saved-project compatibility.
- Cast-specific aggregation, voice binding and scene/prop editing remain in Cast.
- Image editing is a top-level workbench and is not rendered inside either character entry.
- Director profile internals are lineage/context data and must not be appended to character image prompts.
- New visual design templates and Skills for appearance, expression, action, style, and effects belong to the image editor. The character workbench resolves person, era, look and continuity for downstream use; it does not gain another template editor.
- Existing character fields, candidates, and accepted facet IDs are not migrated or deleted by this cleanup.

## Success criteria

1. Asset library and Cast character entry both render `CharacterWorkbench`.
2. No character path renders `CastWorkbenchModal`.
3. Facets have one implementation and one fallback source.
4. Route-level tests prove both entry paths mount the canonical component.
5. Typecheck, focused UI tests and a production build pass before deployment.

## Cleanup scope

Remove the duplicate character facet loader and panel from `CastWorkbenchModal`. Cast character entry already routes through `CharacterWorkbenchBridge`; the modal keeps scene/prop generation and its existing compatibility helpers. Director and shooting-plan contracts are outside this change.
