# Character asset prompt references v1

## Observed

- Assets → character design renders a plain textarea for the full-body, three-view, and headshot prompts.
- The project asset-index endpoint already exposes the owner/project-scoped reference index and stable variant IDs.
- The asset-generation API already accepts an ordered `references` list and an explicit `image_generation_mode`.

## Direct implication

Typing `@` in the character prompt cannot show reference clips or produce structured references. A prompt can only be submitted as text, even though the backend contract can carry stable asset/variant identities.

## Contract

- When the user types `@` (or `@` followed by a query) in a static character prompt, show a project-scoped picker containing characters, scenes, and props with available image variants.
- Choosing a clip inserts visible `@Asset name` text and records the selected variant as `{asset_type, asset_id, variant_id}` in selection order.
- The visible prompt remains the user-editable source text. Structured references are a second, explicit channel; typing an unselected `@name` does not create a reference.
- Generation uses `image_generation_mode: "reference"` only when at least one clip was explicitly chosen, and sends the ordered `references` list. With no chosen clips it sends `image_generation_mode: "text"` and no references.
- No current character image, uploaded variant, or selected variant is implicitly attached as a provider reference by this UI change.
- The picker is project/owner scoped through `GET /projects/{project_id}/asset-index`; it must not proxy arbitrary URLs or persist signed URLs as reference truth.
- A reference selection is local to the active prompt panel. Switching between full-body, three-view, and headshot prompts does not merge their selections.

## Boundaries

- v1 supports image variants only; video/audio/text references remain out of scope.
- v1 does not change provider routing or model capability limits. The existing backend validates the reference count and resolves stable IDs at task creation/execution.
- If the index request fails, the prompt remains usable as text and the picker shows an unavailable state; no implicit fallback is introduced.

## Success criteria

1. Character prompt `@` opens a listbox with indexed clips and thumbnails.
2. Query text filters clips; selecting one replaces only the active `@query`, preserves the rest of the prompt, and emits its stable reference.
3. Character generation with a selected clip sends `references` in order and `image_generation_mode="reference"`; text-only generation sends no references and mode `text`.
4. Frontend unit tests cover the picker, insertion/filtering, and generation request boundary; typecheck passes.
