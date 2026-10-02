# Playground Result Ratio Release Contract v1

## Contract

`ResultCard` media frames must derive their CSS `aspect-ratio` from the persisted
generation parameters through `getOutputAspectRatio()`. The completed,
processing, pending, and failed states all use the same binding. The helper
accepts the canonical `aspect_ratio` field and the historical `ratio` and
`aspectRatio` spellings used by older persisted generations.

## Regression gates

- `npm run check:playground-ratio` rejects a hard-coded 16:9 ResultCard frame.
- `npm run typecheck` and the ResultCard/media ratio tests run in CI.
- `npm run build` writes `build-manifest.json` beside the export, including the
  source revision and `playground_ratio_contract: v1`.

## Publish boundary

The iframe frontend serves a host bind mount. Replacing the host directory does
not update an already running container's mounted directory inode. A static
publish therefore must atomically install the new directory, restart the
frontend container to remount it, and verify `GET /build-manifest.json` before
calling the release active.

## Evidence required after publish

1. repository revision is the intended release commit;
2. served manifest identifies that release and contract revision;
3. frontend container has been restarted after the directory replacement;
4. the served static response, rather than only the source tree, is the object
   used for smoke verification.
