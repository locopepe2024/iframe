# Shot frame selection from the asset library

## Observed

The asset drawer previews an owned variant through `/asset-index/preview`, but
selecting it appends the index's projected `variant.url` to a shot's first or
last frame history. That URL can be an expired delivery signature. The image
retry control then reloads the same URL, and video submission can receive the
same expired value.

## Change boundary

Selection sends the project, frame, slot and asset variant identity to the
server. The server verifies project membership and owner access. For local
storage, it copies the original asset into the owner's shot input directory;
this also covers older asset paths outside the current Studio media directory.
For managed cloud storage, it saves the durable object key. It returns the
updated frame projection. The drawer must keep the selection open on a failed
attach and show the failure. Generated and uploaded frame paths remain
unchanged. The existing bounded 10-frame history remains in force.

## Verification

- An asset with an expired projected URL and a valid local storage key attaches
  an owned copy of the original, not the URL, for either frame slot.
- A foreign or missing variant cannot be attached.
- The frontend uses the returned frame state and surfaces attach failure.
- The selected frame can be previewed and supplied to video generation after
  the asset index's original signature expires.

## Project membership at selection time

The first/last frame drawer must not turn legacy project arrays into selectable
frame variants while the authoritative `scope=project` index is loading or has
failed. Those arrays lack a reliable source container. Show loading or a retry
control instead. Before attaching, refresh the project index and match the
asset type, ID, source scope, source container and variant ID. A variant removed
since the drawer opened stays unsubmitted; refresh the visible list and explain
that the user must reselect it. Validate membership before creating a new frame.

Verify that a legacy-only variant cannot be selected while the project index is
unavailable, and that a project or inherited-series variant remains selectable
after the index loads.
