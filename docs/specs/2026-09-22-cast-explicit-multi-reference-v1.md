# Cast explicit multi-reference v1

Status: implemented
Date: 2026-09-22

## Problem

Cast generation currently has one `reference` field outside the prompt. Selecting
or uploading an image can therefore change a text-to-image request into an edit
request without any visible instruction in the prompt. It also cannot express a
composition such as keeping one character while adding the watch shown in a
second image.

## Contract

- Every image used by the current Cast UI must have a visible `@{mention_id}`
  token in the editable prompt.
- The request sends `references`, where each entry contains `mention_id`,
  `asset_type`, `asset_id`, and `variant_id`. It never sends a provider URL.
- The server resolves all entries against the current project/series/owner
  boundary before creating the asynchronous task.
- References are attached in first-mention order. Repeated mentions reuse the
  same attachment. Tokens compile to `<Picture N>` using that exact order.
- Unresolved `@`, handwritten provider labels, unused reference entries,
  missing/deleted variants, and more than nine unique images are rejected before
  a paid provider task is persisted.
- Uploading a Cast image creates and selects a new variant, then inserts a
  visible mention into the prompt. Selecting a gallery variant changes the
  asset's canonical output only; it does not silently affect generation input.
- The legacy singular `reference` request remains accepted for older clients,
  but the Cast UI no longer submits it.

Example:

```json
{
  "prompt": "保持 @{character_ref} 的人物外观，左腕佩戴 @{watch_ref}",
  "references": [
    {"mention_id": "character_ref", "asset_type": "character", "asset_id": "actor", "variant_id": "front"},
    {"mention_id": "watch_ref", "asset_type": "prop", "asset_id": "watch", "variant_id": "product-front"}
  ]
}
```

Provider input is compiled to:

```text
保持 <Picture 1> 的人物外观，左腕佩戴 <Picture 2>
```

with the character and watch images attached in that order.

## Success criteria

- The prompt is the complete user-visible source of truth for reference use.
- Character plus prop references reach one image-edit request in matching order.
- Removing a token removes the corresponding Provider attachment.
- Invalid or inaccessible references fail before task creation.
- Generated variants record the ordered stable reference identities.
- Focused backend/frontend tests, TypeScript, and production build pass.

## Boundaries

- No real paid generation is submitted during verification.
- No arbitrary URL proxy or browser-supplied Provider URL is added.
- This slice changes Cast image generation, not storyboard/video reference UX.
