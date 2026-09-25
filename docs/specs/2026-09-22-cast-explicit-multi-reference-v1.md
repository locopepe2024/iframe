# Cast explicit multi-reference v1

Status: corrected after production feedback
Date: 2026-09-22

## Problem

Cast generation needs explicit, user-editable reference inputs without forcing
storyboard/provider syntax into the asset prompt. The previous implementation
required an `@{mention_id}` token before an image was attached. In the actual
series Asset workflow, selecting a gallery variant only changed the canonical
output and the separate `@` action was not discoverable, so an apparently
selected reference could still submit a text-to-image request.

## Contract

Series and Cast asset generation owns a visible ordered reference-image list.

- The request carries an explicit `image_generation_mode`: `text` or
  `reference`. The mode is selected by the user and is never inferred from
  whether the request happens to contain images.
- `text` rejects reference inputs and selects the Provider generation route.
  `reference` requires at least one resolved image and selects the Provider
  edit/reference route.
- The user adds or removes concrete image variants in a dedicated reference
  panel. This list is visible and editable; canonical gallery selection remains
  a separate output-selection action.
- The request sends `references`, where each entry contains only `asset_type`,
  `asset_id`, and `variant_id`. It never sends a provider URL or mention ID.
- The prompt remains ordinary natural language. Asset generation does not
  recognize or compile `@` tokens and does not inject `<Picture N>` labels.
- The server resolves every entry against the current project/series/owner
  boundary before creating the asynchronous task and again at execution.
- Reference order is preserved when attachments reach the image model. Any
  provider-specific image-edit payload is compiled by the image adapter.
- Uploading a Cast image creates/selects a new variant and adds it to the visible
  reference list for the next generation.
- Unknown, deleted, cross-owner, duplicate, or excessive references fail before
  a paid task is persisted.
- The legacy singular `reference` request remains accepted for older clients.

Example:

```json
{
  "image_generation_mode": "reference",
  "prompt": "保持角色外观，左腕增加参考图中的手表",
  "references": [
    {"asset_type": "character", "asset_id": "actor", "variant_id": "front"},
    {"asset_type": "prop", "asset_id": "watch", "variant_id": "product-front"}
  ]
}
```

The image adapter receives the unchanged prompt plus the two resolved image
attachments in that order. Storyboard/agent flows may separately compile `@`
references for Seedance, Minimax, or another video-provider protocol; that is
outside this Asset contract.

## Success criteria

- The visible reference panel is the source of truth for Asset image inputs.
- Character plus prop references reach one image-edit request in matching order.
- Removing a reference chip removes the corresponding Provider attachment.
- Invalid or inaccessible references fail before task creation.
- Generated variants record the ordered stable reference identities.
- A request with references selects GPT Image 2 edit rather than generation.
- Adding a reference never changes the generation mode automatically.
- Focused backend/frontend tests, TypeScript, and production build pass.

## Boundaries

- No real paid generation is submitted during verification.
- No arbitrary URL proxy or browser-supplied Provider URL is added.
- This slice changes Cast image generation, not storyboard/video reference UX
  or its model-specific reference compilation.
