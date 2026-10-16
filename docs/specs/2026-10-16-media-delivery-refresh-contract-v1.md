# Media delivery refresh contract v1

## Observed

iFrame returns owner-authorized media through short-lived signed URLs. History
and Agent responses can refresh them, but a browser tab can keep a response
longer than its TTL. UI modules must not treat a signed URL as durable identity.

## Contract

Durable records use `media_id`, an owner-scoped storage key, or a stable
`generation_id` plus `output_id`. Signed URLs are response projections only;
they are never persisted in drafts, asset records, storyboard state, assembly
plans, Agent messages, or queued jobs.

Lists and details hydrate a current URL. Preview, download, editor import,
reference selection, and playback refresh the stable identity immediately
before use. A 401/expired result may retry once after refresh, then fails with
an actionable error. Refresh requires the authenticated owner, verifies scope,
file existence, and requested variant. Arbitrary remote URLs are not accepted.

## Current audit

| Area | Code fact | Direct implication | Stable identity |
| --- | --- | --- | --- |
| Playground image/video and Agent | History and Agent responses project signed paths; browser components retain returned URLs. | A tab open beyond the TTL may fail on later preview. | Generation/output IDs; validated attachment reference. |
| Asset library and character references | Asset responses sign Studio paths; inspectors and pickers consume returned variant URLs. | Response-time signing alone does not cover a later click. | Asset/variant IDs or scoped storage key. |
| Storyboard scene/frame | Frame payloads carry `image_url`, `rendered_image_url`, and variant URLs; the R2V screen resolves them for display. | Generic URL resolution does not refresh an expired signature. | Project/frame/variant IDs. |
| Shot videos | Frame/task `video_url` is used in candidate panels and `StoryboardR2V`. | Long-open playback and download can use a stale URL. | Video task and output IDs. |
| Assembly clips and output | Assembly selects frame/task URLs and `VideoAssembly` passes them to `getAssetUrl`. | Browser playback needs a separate refresh boundary even when rendering uses local media IDs. | Frame/task IDs; merged render ID. |
| Recreation library | API signs `storage_path` in responses; library directly uses it for thumbnails and playback. | It has the same response-time signing gap. | `media_id`. |

These are code facts and direct implications, not proof that every entry has failed in production. Production confirmation requires an expired-time replay or observed media 401/403.

## Module obligations

| Module | Durable source | Refresh boundary |
| --- | --- | --- |
| Playground and Agent | generation/output or media registry IDs | history/detail response and open/use/download |
| Asset library and character references | asset/variant/media IDs | asset response and picker/editor selection |
| Storyboard scene/frame | frame/variant media IDs | frame response and first-frame selection |
| Shot video | video task/media ID | task response and playback/download |
| Assembly | immutable clip/task/media IDs | assembly response and playback/download |

Local, COS, and OSS adapters share this identity-to-delivery boundary. Provider
URLs are not browser identity. Scope, owner, revision pins, and media kind
checks survive every refresh.

## Verification

- Advance time beyond the URL TTL, open each preview, and assert a fresh URL
  while the durable identity remains unchanged.
- Reject foreign owners, missing files, traversal locators, and invalid
  signatures; allow valid authenticated refresh.
- Refresh does not mutate drafts, Agent messages, asset records, frames, or
  assembly plans.
- One shared client helper handles refresh-on-open and one 401 retry; screens
  do not implement signature generation independently.

This is the boundary specification; migration of all listed modules remains a
separate task.

## Unified wrapper

Use one backend delivery service and one frontend client. The backend accepts a typed media locator, checks the authenticated owner and project scope, verifies the requested variant and real file under the configured root, and issues a short-lived URL. It must reject arbitrary remote URLs as locators.

Locator kinds: `playground_output` (generation/output), `asset_variant` (asset/variant), `storyboard_frame` (project/frame/variant), `video_output` (project/task/output), `assembly_output` (project/render), and `recreation_media` (media ID). Legacy owner-scoped Studio storage keys need an explicit migration adapter.

The frontend client resolves a locator immediately before preview, playback, download, editor import, or reference selection. List responses may carry short-lived preview URLs for fast paint; those are caches, never persistent identity. A media 401 can trigger one refresh and retry. The wrapper reports missing, unauthorized, and expired media distinctly.

Migrate in order: (1) backend owner/path contract, (2) Playground and Agent including GalleryView, (3) asset library, character references, and Recreation, (4) storyboard scene/frame and first-frame selection, (5) shot video candidates, (6) Assembly clips and merged outputs. Each slice needs an expired-time interaction test and cross-owner rejection test. Refresh never rewrites drafts, Agent messages, asset records, frames, tasks, or assembly plans.

## Media body and cover policy

Every managed media record has two related delivery projections:

| Projection | Purpose | Durable value | Delivery rule |
| --- | --- | --- | --- |
| `source` | Full image, video, audio, or editor input | media ID plus owner-scoped storage key and revision | Refresh immediately before playback, download, editor import, model reference selection, or Agent attachment. |
| `cover` | Small card, picker, storyboard, character, or video poster image | cover media ID or deterministic source revision; never a signed URL | Serve an owner-authorized WebP preview generated from the current source revision. Refresh the preview URL when the card/picker is opened or an image error indicates expiry. |

The source and cover may share the same media identity, but a cover is a derived
artifact and must be invalidated when the source revision changes. A cover must
not silently become the source used for generation. A source URL must not be
used as a card cover when a WebP preview is available.

The current backend already contains bounded WebP preview primitives:
`create_media_thumbnail` writes `.media-previews/*.webp`, asset previews use
`.asset-previews/*.webp`, and `/asset-index/preview` returns `image/webp`.
These are useful implementation pieces, but their presence does not prove all
frontends use them. The migration must replace direct use of fields such as
`image_url`, `rendered_image_url`, `video_url`, `storage_path`, and
`thumbnail_url` with a typed source/cover locator where the media is managed.

Required cover behavior:

1. Generate WebP at a bounded size from the verified current source, with a
   cache key containing source identity, revision, and requested size.
2. Store the preview under the same owner/storage boundary as the source, or
   in a provider object namespace addressed by a stable preview ID.
3. Return `media_type=image/webp` and no provider URL as the durable record.
4. Reject cross-owner, missing, traversal, and stale-revision requests.
5. Keep video covers as WebP stills; the original video remains the source.

Audit checklist for every consumer:

- Does the record retain a stable source/cover identity, or only a signed URL?
- Does list hydration use a preview URL only as a cache?
- Does click, play, download, edit, reference selection, and Agent attachment
  resolve the current source/cover URL?
- Does a 401/expired response refresh once and then surface a clear error?
- Does replacing the source invalidate the old cover revision?
- Is the cover WebP and bounded, including character workbench, image editor,
  storyboard first-frame thumbnails, shot video cards, asset library, and
  assembly views?

No module is considered migrated until both source and cover paths pass the
expired-time, replacement-revision, missing-file, traversal, and cross-owner
tests.
