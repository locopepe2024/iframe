# Unified Workbench Media Contract V1

## Decision

Playground, Character Workbench, Storyboard, Shot Design, and Asset delivery
share one media identity boundary.

- `media_id`: stable owner-scoped identity of one immutable material file.
- `storage_key`: server-only locator in local output, COS, or OSS.
- `asset_id + variant_id`: semantic asset binding; a variant points to one
  `media_id`.
- `delivery_url`: short-lived preview/provider URL generated from the media
  record; it is never persisted as identity.

Temporary uploads, generated outputs, editor results, storyboard frames, shot
references, and role-specific asset material are all media records. A file can
exist as media without being an asset. Confirming it as an asset creates a
variant binding and does not copy or replace the media identity.

## Delivery routes

The route namespaces remain distinct because they expose different ownership
and lifecycle checks:

- `/playground/input-media/...`: temporary uploaded material
- `/playground/media/...`: Playground generation output
- `/studio/media/...`: reusable Studio/asset material

These are delivery routes only. Backend input normalization accepts a managed
relative path or an absolute managed URL, reduces it to the canonical path,
then resolves ownership. External URLs are not server fetch targets.

## Workbench rules

1. Upload returns a `media_id` plus a delivery projection.
2. Generation returns a new `media_id` for every materialized output.
3. Editor, Character Workbench, Storyboard, and Shot Design persist media IDs
   or typed asset-variant references, never signed URLs.
4. Reusing material keeps the same `media_id`; replacing bytes creates a new
   media ID.
5. Asset cover, selected variant, first/last frame, and R2V reference are
   roles on a binding. They are not alternate media identities.
6. Owner validation happens before local resolution or provider submission.

## Migration

Legacy path fields remain read-compatible at the boundary. New writes must
include the structured media identity. Migration is idempotent and rejects
ambiguous, missing, or foreign paths rather than guessing.

## Verification

- managed absolute and relative routes normalize to one path
- arbitrary remote URLs are rejected
- owner isolation holds for every workbench
- editor outputs, asset variants, storyboard frames, and shot references keep
  stable media IDs after refresh and delivery URL renewal
