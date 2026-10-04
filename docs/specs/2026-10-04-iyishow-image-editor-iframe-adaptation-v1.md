# iYishow image editor adaptation to iFrame v1

## Existing facts

- Both products use Filerobot for local crop, rotate, color, annotation, watermark and resize. iFrame already owns immutable image-edit saves and a panorama viewer.
- iYishow additionally exposes upscale, outpaint, repaint, erase and cutout through a separate generative task, mask and asset-document protocol. These request contracts are not present in iFrame Playground.
- iFrame's owner-scoped Studio asset index enumerates variant IDs; Playground accepts owner-scoped image references and image generation tasks.

## Contract

- The editor may use one current base image and up to nine ordered references. Uploads enter owner-scoped Playground storage. Library selections use stable scope, container, asset and variant IDs resolved on the backend; arbitrary URLs never become server fetch targets.
- The image editor keeps references in its current browser session. A generated result is an ordinary Playground generation with source and prompt lineage, not a local edit. A selected output may become the next editable base.
- Panorama generation is an explicitly requested image generation task with a 360-degree equirectangular prompt. Its output is a candidate only. The user must inspect it, produce an exact 2:1 image if needed, and explicitly save it with `equirectangular` projection before director admission.
- Model choices come from the active UniArt catalog and are filtered by actual `t2i` / `i2i` capability. Reference limits are enforced against the selected model. No unsupported mask operation is shown as executable.

## Acceptance

1. Multi-file upload and library selection can build, reorder and remove a bounded ordered reference list; each library item is resolved using current owner visibility.
2. Generation sends the ordered base and references through Playground; status and output are visible in the editor, with failure and retry states.
3. The panorama entry creates a labeled candidate, opens the 360 viewer only for declared 2:1 saved outputs, and never treats a generated candidate as a verified spatial panorama.
4. Local editing and source hash checks remain unchanged. Existing image edits and director imports continue working.
5. Tests cover owner rejection, invalid variant, reference order, generation payload and panorama gate; typecheck and production build pass.

## Staged implementation

1. Owner-scoped Studio variant import into Playground storage.
2. Editor reference tray and library picker.
3. Generation controls and status with active model capability filtering.
4. Panorama candidate command, output handoff, and verification.
5. Separate future contract for mask generation operations and durable editing documents.
