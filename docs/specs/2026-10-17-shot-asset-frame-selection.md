# Shot frame selection from the asset library

## Observed

The asset drawer previews an owned variant through `/asset-index/preview`, but
selecting it appends the index's projected `variant.url` to a shot's first or
last frame history. That URL can be an expired delivery signature. The image
retry control then reloads the same URL, and video submission can receive the
same expired value.

## Change boundary

Selection sends the project, frame, slot and asset variant identity to the
server. The server verifies project membership and owner access, then stores
the variant's durable storage key in the selected frame history. It returns
the updated frame projection. The drawer must keep the selection open on a
failed attach and show the failure. Generated and uploaded frame paths remain
unchanged. The existing bounded 10-frame history remains in force.

## Verification

- An asset with an expired projected URL and a valid storage key attaches the
  key, not the URL, for either frame slot.
- A foreign or missing variant cannot be attached.
- The frontend uses the returned frame state and surfaces attach failure.
- The selected frame can be previewed and supplied to video generation after
  the asset index's original signature expires.
