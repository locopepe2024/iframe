# Cast asset-library reference input v1

Status: implemented
Date: 2026-09-20

## Problem

Cast image generation currently supports uploaded reference images through
`reference_image_url`, but it cannot select a reusable project, series, or
personal library asset variant. Users must upload the same reference again,
and the request loses the semantic identity of the selected asset.

## Evidence

- `GenerateAssetRequest.reference_image_url` is the only image-generation
  reference field at the Cast API boundary.
- `Character.reference_sheet`, `Scene.image_asset`, and `Prop.image_asset`
  already store stable asset and variant IDs with selected variants.
- The project read API presents episode, series, and global assets together,
  while generation resolves the source server-side with `_find_asset_with_source`.
- UniArt image generation accepts resolved HTTP image references through the
  image adapter; provider URLs are delivery projections, not durable identity.

## Scope

This slice adds explicit asset-library reference selection to Cast image
generation for character, scene, and prop entities.

In scope:

1. A versioned request reference object containing `asset_type`, `asset_id`,
   and `variant_id`.
2. Owner-scoped server validation and resolution of the selected variant.
3. Persistence of the immutable reference object in the async task params and
   generated `ImageVariant` provenance.
4. A Cast picker that lists the current project/series/global assets already
   visible to the current owner and lets the user select one variant.
5. Existing upload-reference behavior and legacy `reference_image_url`
   compatibility.

Out of scope:

- Automatic implicit use of the current asset's selected image.
- Multiple reference images in this Cast slice.
- Storyboard multi-reference selection (tracked by the storyboard contract).
- Provider-specific visual quality guarantees.
- Editing masks or local image edits.

## Contract

`GenerateAssetRequest` accepts:

```json
{
  "reference": {
    "asset_type": "character | scene | prop",
    "asset_id": "...",
    "variant_id": "..."
  }
}
```

The server rejects a reference when the asset type is invalid, the asset is
not visible to the requesting owner, or the variant does not belong to that
asset. The server resolves the selected variant to a provider-ready image
reference only inside task execution. The client does not submit a durable
provider URL for a library reference.

The task snapshot persists the normalized reference object. Generated image
variants persist `reference_asset_type`, `reference_asset_id`, and
`reference_variant_id` so the UI/history can explain which source was used.

A library reference is an explicit choice. If the user clears it, generation
remains text-to-image unless an uploaded `reference_image_url` is supplied.
If both are supplied, the structured library reference wins and the raw URL is
ignored for the generation request.

## Success criteria

- A Cast request with a selected library variant reaches the backend with the
  exact IDs and no provider URL from the browser.
- The backend rejects foreign/missing assets and variants before provider work.
- The async task snapshot retains the reference IDs.
- The image adapter receives the resolved image reference exactly once.
- Character generation uses the resolved reference for `reference_sheet` and
  the legacy `full_body` / `three_view` / `headshot` modes as well.
- `ImageVariant.prompt_used` and reference provenance point to the same task.
- Existing upload-only generation and old clients remain compatible.
- Focused backend and frontend tests pass; full backend regression remains green.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/api.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/assets.py`
- `frontend/src/components/modules/cast/CastWorkbenchModal.tsx`
- `frontend/src/lib/api.ts`
- focused tests
