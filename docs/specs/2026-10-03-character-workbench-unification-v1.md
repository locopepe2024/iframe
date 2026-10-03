# Character Workbench Unification v1

## Decision

`CharacterWorkbench` is the single character editing and generation UI. The asset library already renders it. The Cast workflow must route character opens through an adapter that renders the same component; Cast keeps its existing `CastWorkbenchModal` only for scenes and props.

## Boundaries

- Character identity, episode look variants, continuity facets, prompts, uploads and generation actions live in `CharacterWorkbench`.
- Cast-specific aggregation, voice binding and scene/prop editing remain in Cast.
- Image editing is a top-level workbench and is not rendered inside either character entry.
- Director profile internals are lineage/context data and must not be appended to character image prompts.

## Success criteria

1. Asset library and Cast character entry both render `CharacterWorkbench`.
2. No character path renders `CastWorkbenchModal`.
3. Facets have one implementation and one fallback source.
4. Route-level tests prove both entry paths mount the canonical component.
5. Typecheck, focused UI tests and a production build pass before deployment.
