# Character Reference Editor Source v1

## Problem

Character images returned to the browser can be short-lived signed COS URLs.
They are valid for ordinary image display, but the browser image editor needs
canvas-readable pixels and can fail when the object response does not grant
cross-origin canvas access. The legacy Character Workbench also exposes edit
for an existing image without exposing upload in the same panel.

## Contract

- Add an authenticated project endpoint that resolves an image by stable
  `project_id`, `asset_type`, `asset_id`, and `variant_id`.
- The endpoint may serve only a variant visible through that project's owner
  boundary. It must not accept an arbitrary remote URL from the browser.
- The response is an image body with private, no-store caching and a bounded
  maximum size.
- Character image editors use this same-origin endpoint instead of a signed
  provider URL.
- Full-body, three-view, and headshot panels expose upload controls. Uploads
  reuse the existing asset upload endpoint and create a newly selected variant;
  they do not overwrite the prior image.

## Boundaries

- No provider generation is submitted.
- No COS CORS policy is changed.
- No existing variant is rewritten or deleted.
- Scene-specific wardrobe records remain outside this slice.

## Success Criteria

- A COS-backed character variant opens in the image editor through the Studio
  API origin.
- A user can upload a replacement directly from each static character panel.
- Unknown or non-owned variants return 404/422 rather than proxying a caller
  supplied URL.
- Backend tests, focused frontend tests, typecheck, and production build pass.
