# Asset, Material, and Reference Contract V1

Status: implementation slice in progress
Date: 2026-09-22

## Goal

Establish one read authority for reusable Studio assets before migrating media
storage or storyboard provider protocols. Cast, Assets, and generation
workbenches must not build competing interpretations of the same asset pools.

## Evidence

Code facts at `5a77fbab`:

- Studio persists semantic `Character`, `Scene`, and `Prop` objects at episode,
  series, and global scopes.
- Character images use `AssetUnit.image_variants`; scene and prop images use
  `ImageAsset.variants`. Cast normalizes these shapes in the browser.
- Cast independently combines project, current-series, and global-library
  responses to construct its reference picker.
- Asset generation persists ordered stable references as
  `asset_type + asset_id + variant_id`, then resolves delivery paths at task
  execution.
- Playground still identifies new inputs with paths and output IDs. Recreation
  has a separate owner-scoped `media_id` registry. There is no shared Studio
  media registry yet.
- Promote, fork, and cross-series import deep-copy assets. They issue a new
  asset ID but currently retain copied variant IDs.

Direct implication: the current risk is not three physical asset databases.
It is multiple read projections, two variant-container schemas, path-based
materials, and copy operations without explicit lineage.

Not yet proven: an observed production reference collision or incorrect asset
resolution caused by copied variant IDs. This remains a migration risk, not a
confirmed incident.

## Canonical Terms

- **Material / Media**: one immutable stored file. Future authority: `media_id`.
- **Asset**: one semantic character, scene, or prop. Authority: `asset_id`.
- **Asset variant**: one immutable visual version belonging to an asset.
  Authority today: `(asset_type, asset_id, variant_id)`; future storage also
  points to `media_id`.
- **Placement**: an asset's availability in episode, series, or global scope.
  V1 exposes resolved placement but does not replace persisted arrays.
- **Reference binding**: one ordered draft/task use of an asset variant. It is
  not a copy of an asset or a delivery URL.
- **Generation snapshot**: immutable submitted mode, ordered bindings, prompt,
  and model configuration. Existing async task params remain the V1 snapshot.

## V1 Read Contract

`GET /projects/{project_id}/asset-index` returns a versioned normalized view:

```json
{
  "schema_version": 1,
  "project_id": "episode-id",
  "assets": [
    {
      "asset_type": "character",
      "asset_id": "char-id",
      "name": "角色名",
      "source_scope": "series",
      "source_container_id": "series-id",
      "selected_variant_id": "variant-id",
      "variants": [
        {"id": "variant-id", "url": "delivery projection"}
      ]
    }
  ]
}
```

Rules:

1. Episode overrides series, and series overrides global, by asset type and ID.
2. The server normalizes character, scene, and prop variant containers.
3. Signed/local delivery URLs are response projections only. Cast submits only
   stable IDs from the entry.
4. Ordering of `references` remains the ordering sent to the image adapter.
5. This endpoint is a read model. Mutations continue through existing asset and
   variant endpoints in V1.

`GET /asset-index` returns the same entry schema for the owner-scoped Assets
catalog. Unlike the project endpoint, it preserves each series, standalone
project, and global placement instead of applying episode precedence. Entries
include `source_name`, `description`, and `starred` so the catalog does not need
to join or reconstruct display state from the persisted containers.

## V1 Scope

In scope:

- Add the normalized, owner-scoped project asset index.
- Move Cast's reusable-reference picker to that index.
- Move Assets and storyboard selectors to the normalized index. A single
  compatibility adapter may read legacy project arrays while an index request
  is unavailable; selector components do not inspect container schemas.
- Keep explicit text/reference generation mode and ordered stable references.
- Preserve legacy generation requests and persisted project shapes.

Out of scope:

- Shared `media_id` migration for Studio and Playground.
- Replacing episode/series/global arrays with placements.
- Changing storyboard `@` compilation or provider-specific prompt syntax.
- Changing promote/fork/import behavior.
- Hard-delete/tombstone migration.

## Success Criteria

- One backend method owns effective asset precedence and variant normalization.
- Cast no longer combines current project, series, and global assets itself.
- A global-only asset remains selectable from a project.
- A colliding lower-scope asset ID is absent from the index.
- Character legacy variants remain readable.
- Cast submissions contain ordered stable IDs and no media URL.
- Existing asset generation, frontend tests, typecheck, and production build
  remain green.

## Follow-up Cutovers

1. Add a shared owner-scoped media registry and backfill `media_id`.
2. Add immutable variant lineage and fresh child variant IDs on fork/copy.
3. Introduce asset placements so sharing does not require deep-copy.
4. Remove the legacy selector adapter after all project readers require schema
   version 1.
5. Add tombstones and reverse-reference checks before retiring hard deletion.
