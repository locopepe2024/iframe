# Image panorama to 3D director workflow v1

## Scope and assumptions

- A saved image edit is an immutable, owner-scoped Playground asset. Its projection is explicit metadata, never inferred from a filename or 2:1 ratio alone.
- A user may designate a saved 2:1 still image as an equirectangular panorama. Ratio validation is necessary but does not prove geometric correctness; the declaration remains a user assertion.
- The browser director provides interactive composition and path preview with white models. It does not claim to produce a Blender render on the media host.

## Contract and boundaries

- Image editor: preserve the source image, save ordinary edits as `perspective_plane`, and expose a separate "Save as panorama" action for exact 2:1 sources. That action writes `equirectangular`; users do not choose raw projection metadata. Browse panorama candidates with mouse/touch orbit controls.
- Playground API: persist projection metadata and panorama quality diagnostics in the same immutable edit record and idempotency intent; reject an equirectangular declaration for non-2:1 output or a detected seam/zenith/nadir gap.
- Director: read only the current owner's saved edits, admit only declared 2:1 equirectangular images whose stored checksum matches the catalog admission checksum, show a spherical background, and let the user assign/clear it. Existing scene objects, white models, cameras, motion paths and timeline remain the editable foreground.
- The environment catalog is session state. Director drafts must not silently restore a panorama without reloading and validating its owner-scoped asset record.

## Acceptance

1. A normal edit remains a perspective image and cannot enter the panorama selector.
2. A non-2:1 image cannot be saved as equirectangular, including if the editor changed dimensions after selection.
3. A declared panorama appears in the image editor viewer; only a declared 2:1 image that passes seam and pole-gap diagnostics appears in director's environment list after refresh.
4. Assigning it shows a nonblank inside-out 360-degree background in director and camera views, while actor/prop placement, camera adjustment and path/timeline preview remain usable.
5. Asset fetch or texture decode failures show an error; stale, inaccessible, or quality-failed records are not silently substituted.
6. Typecheck, focused frontend tests, backend API tests and production build pass.

## Implementation order and affected paths

1. `src/apps/playground/image_editor.py`, `src/apps/playground/api.py`, `tests/test_image_editor.py`: projection metadata and validation.
2. `frontend/src/lib/imageEditor.ts`, image editor components and messages: selection and interactive viewer.
3. `frontend/src/components/director3d/`: owner-scoped catalog loading, assignment controls and sphere rendering.
4. Verify integration and visual framing. A media-host Blender output pipeline requires a separate render handoff and host verification.
