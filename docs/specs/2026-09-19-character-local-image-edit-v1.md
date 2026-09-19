# Character local image editing v1

## Observed

- iFrame already ships a shared `ImageEditor` with local export and an
  `Annotate` tab (pen, arrows, shapes, and text).
- The Studio character workbench already has three independent static reference
  slots: full body, three views, and headshot.
- Studio upload already creates an immutable uploaded image variant and keeps
  the previous variants available.
- The current UniArt image-edit contract is still changing, so this slice must
  not invent a provider request or route.

## Scope

- Add an edit action to each character static reference panel when an image is
  selected.
- Open the shared editor with the selected image and the panel's existing
  aspect context.
- Save the exported image through the existing Studio asset upload endpoint as
  the matching character variant type.
- Preserve the original image and show the saved result as the selected variant.
- Keep annotation pixels in the saved reference image for this local slice.

## Boundary

- No UniArt request, provider routing, or paid generation is added.
- No AI mask is silently inferred from annotations. A separate mask payload will
  be added only after the UniArt edit contract defines its source, mask, and
  operation identity fields.
- Scene and prop workbenches are out of scope for this slice.

## Success criteria

1. A character with a selected full-body, three-view, or headshot image shows an
   accessible edit action with a 44px target.
2. Saving from the editor calls the existing upload endpoint with the matching
   `full_body`, `three_views`, or `head_shot` type.
3. The backend response updates the project state without removing other
   assets or variants.
4. The original image remains available as an earlier variant.
5. Existing image-editor tests, frontend typecheck, and production build pass.
