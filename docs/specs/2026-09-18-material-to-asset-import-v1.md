# Material-to-Asset Import V1

Status: implemented slice, pending release verification.

## Observed

- Playground uploads and generation outputs are concrete media files used as
  references and results.
- The legacy `save-to-library` endpoint only copies an output file and sets
  `saved_to_library`; it does not create a `Character`, `Scene`, or `Prop`.
- Global library entries are semantic assets with an `asset_id`. Their image
  containers hold independently addressable variants with `variant_id` values.
- The current Playground contract exposes output IDs and `media_path`. A shared,
  owner-scoped `media_id` registry described by the reference identity spec is
  not implemented by this slice.

## Direct Implication

Uploaded files and Workbench outputs remain materials by default. Archiving a
material does not make it an asset. A user must explicitly choose **Import as
asset**, select character, scene, or prop, and name the resulting entity.

For image materials, import creates one global asset and one selected initial
image variant. The variant records its source as `upload` or `workbench`.
Video remains material-only in V1.

## Identity Boundaries

| Identity | Meaning |
| --- | --- |
| Playground `generation_id + output_id` | Provenance of one generated result |
| `media_path` | Current file locator; not a durable entity identity |
| `asset_id` | Semantic character, scene, or prop identity |
| `variant_id` | One image attached to an asset |

Import does not reinterpret a path or output ID as an asset ID. It creates new
asset and variant IDs while retaining the material URL and source provenance.
Workbench import sends `generation_id + output_id`; the server resolves the
owner-scoped internal path. A signed preview URL is never persisted as the
asset image and is not accepted as proof of ownership. The created image
variant retains both source IDs as durable provenance.

## Not Yet Proven or Implemented

- A unified media registry and stable `media_id` across upload, Workbench,
  project, series, and global library surfaces.
- Video-to-asset import semantics.
- Deduplication of repeated imports of the same material.
- Automatic alias extraction or Storyboard mention binding from imported assets.

These remain separate migrations and must not be inferred from the V1 UI.

## Success Criteria

- Saving a Playground result is labeled as saving material.
- Image result cards and details expose an explicit import action; videos do not.
- Import creates the selected initial variant for all three asset types.
- Uploaded and Workbench sources remain distinguishable in persisted variants.
- Existing library files without source provenance continue to load.
- Owner assignment and existing cross-user library isolation remain intact.

Affected paths: Playground result/detail UI and messages, global library create
API and pipeline, image variant schema, and focused frontend/backend tests.

Verification commands:

```bash
python -m pytest tests/test_cast_reference_upload.py -q
python -m pytest src/apps/comic_gen/test_shared_asset_channels.py tests/test_multi_user_boundary.py -q
npm --prefix frontend run test:ui -- src/components/modules/playground/ResultCard.test.tsx src/components/library/NewLibraryAssetDialog.test.tsx
npm --prefix frontend run typecheck
DOCKER_BUILD=true npm --prefix frontend run build
```
