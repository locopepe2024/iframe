# Character Reference Single Flight v1

## Status

Implemented locally; production history has not been changed.

## Observed

- Code fact: the Cast workbench defaults to a batch size of two and allows explicit batches of one, two, or four. Successful reference-sheet outputs are appended to the character's variant history.
- Code fact: a project or series asset could accept another generation task while its status was already `processing`. Series submission did not persist that processing status before this change.
- Code fact: the Cast workbench refreshed the project and checked references before registering its local in-flight marker. Repeated clicks during that asynchronous preflight could submit multiple requests.
- Code fact: asset tasks are process-local. A task failure before `generate_asset` reached its own exception boundary could leave the persisted asset status as `processing`.
- Code fact: the normalized project asset index includes historical variants. Storyboard character reference resolution and its chip bar allowed those variants to be selected together.
- Runtime observation from the 2026-09-24 production audit: “谭瑞齐（归国时期）” had five generated full-body variants. Variant records had no task identifier, so they could not be grouped by generation request.

## Direct implications

- The five historical variants do not prove that one submission ran five times. Explicit batches and later re-rolls both append outputs.
- The missing backend in-flight check and frontend preflight guard made duplicate concurrent submissions possible. They did not establish that this caused the observed five variants.
- A character's historical gallery can contain several images while storyboard reference submission uses only its currently selected image.
- The backend's single-flight guarantee applies to concurrent generation tasks for one asset. A user may still explicitly request a multi-image batch; successful batch outputs remain reviewable in history.

## Contract

1. A project, series, or shared asset accepts at most one image-generation task while its asset status is `processing`.
2. Asset lookup, in-flight validation, status transition, task registration, and persistence are serialized under the pipeline save lock.
3. A duplicate generation request returns HTTP 409. The Cast UI also blocks a second click synchronously, including while project/reference validation is pending.
4. A background asset task can transition from `pending` to `processing` only once. Repeated scheduling of the same task ID must not call the provider again.
5. If execution fails before or during generation, the task and any still-processing asset are marked failed with the error persisted. Successful output variants are not deleted as rollback.
6. Cast character generation defaults to one output. Explicit batch sizes remain available and append successful takes to the gallery.
7. Storyboard prompt resolution for a character uses only its selected variant. Historical character variants do not appear as a multi-view toggle beside the character chip. Existing prop multi-view selection remains supported.
8. Historical gallery variants and production media are preserved. This contract changes default reference selection and future task concurrency; it does not delete past images.

## Not yet proven

- The existing five variants cannot be attributed to a number of API submissions because their records do not persist task IDs.
- This change does not prove that every old image is a duplicate or stale. Deleting any of them requires a separate explicit asset cleanup decision.

## Acceptance criteria

- Simultaneous project and series submissions produce one task and one conflict.
- Re-running one task ID does not call generation twice.
- Setup-time project errors and series provider errors persist a failed asset state.
- Two clicks while Cast validation is pending send one generate request.
- A character with five historical variants resolves and displays one selected storyboard reference; prop view selection still works.
- Focused backend/UI tests, frontend typecheck, and release-version consistency checks pass.

## Affected paths

- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/api.py`
- `frontend/src/components/modules/cast/CastWorkbenchModal.tsx`
- `frontend/src/components/modules/storyboard-r2v/AssetChipBar.tsx`
- `frontend/src/components/modules/storyboard-r2v/referenceAssets.ts`
- related backend and frontend tests
