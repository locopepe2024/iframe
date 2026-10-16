# Provider media publication and storage configuration

## Observed

The provider media signer already creates short lived URLs, but API delivery,
upload, preview and Playground construction still had literal `output/` paths.
The GreenA and UniArt adapters also derived signed URLs with the default root
when given an absolute file under a custom media root.

## Change

The API now uses the pipeline's selected root for provider and Studio media
verification, upload targets, thumbnails, static mounts and Playground storage.
`IFRAME_MEDIA_ROOT` selects the local root at process startup. `IFRAME_STORAGE_BACKEND`
records the intended backend (`local`, `cos`, or `oss`) and is validated by the
admin configuration endpoint. Provider origin and TTL, plus Tencent COS
non-secret connection fields, are exposed through the existing configuration
entry point. Existing COS/OSS adapters remain responsible for credentials and
signing.

Changing the root or backend through `/config/env` persists the next-start
configuration and returns `restart_required: true`; it does not mutate an
already constructed pipeline. No deployment or storage migration is performed
by this change.

## Verification

Provider configuration, owner-scoped delivery, custom-root containment,
adapter publication and storage setting tests pass. The public URL remains
short-lived and owner-scoped; local files are never sent directly in provider
request bodies.
