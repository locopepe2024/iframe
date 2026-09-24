# Asset Library Cover Selection v1

## Status

Implementation target for the asset cover update fix.

## Evidence

- Code fact: the owner-scoped asset index flattens a character’s reference sheet, full-body, three-view, and headshot variants into one `variants` list. `selected_variant_id` represents the generation-container selection.
- Code fact: the Asset Library converts that normalized list into a synthetic `reference_sheet` container, so the UI loses each variant’s source container.
- Code fact: cover selection currently calls the category-specific variant endpoint and asks it to return the full project. When `generation_type="reference_sheet"` is supplied for a variant stored in another character container, the pipeline does not select it or return an error; the response still contains the asset.
- Direct implication: the UI can report success while the effective library cover remains unchanged, and the response transfers/signs much more project data than the cover mutation needs.
- Runtime observation: production `/health` returned 200 and OpenAPI exposed both asset-index routes and the generation-clear route. The deployed backend source revision was `0d19f844eea66e74d2794e5478f8be6bf1e57a91`. No user asset data was read.

## Contract and update policy

1. A library cover is an explicit, stable variant ID stored as optional `cover_variant_id` on a character, scene, or prop and exposed separately on index entries. `selected_variant_id` retains its existing generation-container meaning. Existing records without a cover field retain today’s fallback display order.
2. Generation adds candidate variants but does not change an explicit cover. The user changes the cover through a dedicated mutation.
3. The mutation validates that the variant belongs to the addressed asset, persists `cover_variant_id` in the asset’s actual source container, and returns only `{asset_type, asset_id, cover_variant_id, variant}`. The variant projection contains only `id`, `url`, and `created_at`, so a newly generated candidate can appear in the card without returning prompt/provenance data or reloading a project or the library index.
4. Asset Library loads the compact no-store index once on entry. Successful cover changes patch the visible asset locally from the mutation result; no timer or periodic full refresh is used. Existing targeted task polling remains independent.
5. Deleting the selected cover clears the explicit cover pointer; the index then derives a valid fallback from the asset’s remaining selected variants.
6. The project-wide variant-selection endpoint keeps its existing response and per-container semantics for other callers.

## Boundaries

- This slice covers project asset-library cover selection and persistence for characters, scenes, and props.
- It does not change generation status, variant generation, media deletion, series/global cover editing, or desktop auto-update behavior.
- Cover selection is not a media copy and does not change the selected variant inside the generation-specific container.

## Acceptance criteria

- A variant from any indexed character container can become the cover and remains selected after a fresh index/project load.
- Changing the cover does not change `selected_variant_id` or default generation-reference selection.
- Scene and prop cover selection persists the same way.
- An unknown variant ID fails without reporting success or changing the asset.
- Generating additional variants leaves the explicit cover unchanged.
- Cover updates return a compact acknowledgement and do not call the full-project response path.
- The library updates the card from that acknowledgement without another index request; the button exposes pending, success, and failure states.
- Regression tests, frontend typecheck, relevant frontend tests, backend tests, and the production build pass.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/api.py`
- `src/apps/comic_gen/test_asset_reference_index.py` or focused cover tests
- `frontend/src/lib/api.ts`
- `frontend/src/components/library/AssetLibraryPage.tsx`
- `frontend/src/components/library/AssetInspector.tsx`
- relevant frontend tests and version surfaces
