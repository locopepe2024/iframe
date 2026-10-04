# Image editor three-column workbench and reference mentions

## Boundary and assumptions

- Playground remains the generation owner. The editor submits ordered owner-scoped image references and names through the existing generation API.
- A selected image is the current canvas image for local Filerobot editing. Generation inputs come from the explicit reference list, including an image opened from a result card.
- `@name` selection uses the existing Playground reference prompt editor. Duplicate filenames receive unique session labels so each mention resolves to one ordered attachment.
- Generated images are persisted by Playground history whether or not the user saves a local edit. A panorama still requires exact 2:1 dimensions and an explicit "Save as panorama" action before director admission; the editor does not expose a projection selector.
- Panorama generation results open directly in the 360 viewer as unverified candidates, even when their pixels are not exactly 2:1. A mismatched ratio is visibly flagged because the sphere preview distorts the image; it does not change the save or director gate.

## UI and behavior

1. Opening the standalone image editor enters its full-screen workbench immediately.
2. The left rail selects canvas preview, local editing, or panorama browsing where eligible. Its recent-generation queue lists prior images from owner-scoped Playground history, excluding the image currently on the main canvas. Clicking an earlier image makes it current and returns the displaced generated image to the queue. Queue items can also be added to references. Locally saved edit copies remain separately accessible.
3. The middle canvas shows one current image and generation progress. A completed image output becomes the current canvas image automatically. Clicking a reference thumbnail on the right replaces the current canvas image.
4. A completed panorama candidate opens the 360 viewer automatically. The user can rotate, adjust field of view, and return to flat preview. Loading and texture failures are visible.
5. The right rail is always visible and contains ordered reference thumbnails, upload, owner library picker, model, and mention-aware prompt.
6. The generation request sends only the ordered reference list, with a name for each path. The UI keeps references and prompt when the current canvas image changes.

## Acceptance

- A prompt such as `将@file1.png的背包替换成@file2.png` binds the selected images in order.
- Generating from a blank editor, selecting images, and loading a result all stay inside one workbench.
- A generated result that was never saved as a local edit remains discoverable from server history after closing and reopening the editor.
- After another image is generated, the newest result occupies the main canvas and the prior result appears in the left queue; the current result is never duplicated there.
- Saved local edits and panorama copies preserve the existing immutable save and projection rules.
- A generated panorama can be inspected without saving; non-2:1 outputs never become `equirectangular` copies by preview alone.
- Typecheck, focused UI tests, and production build pass. No unrelated worktree changes are included.
