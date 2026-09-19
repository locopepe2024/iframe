# Recreation generation submission v1

## Observed

- Recreation currently builds and validates per-shot H3 prompts, but `submission_enabled` is hard-coded false and no provider task is persisted.
- The shared UniArt video adapter already accepts H3/Seedance model IDs, ordered image references, `generate_audio`, `seed`, and an `on_task_submitted` callback. Its production polling is unbounded and can resume from a saved provider task ID.
- Recreation media records retain owner, path, SHA-256, and metadata, so a generation task can snapshot inputs before any paid request.

## Decision

- Add owner-scoped durable `recreation_generation_tasks` records, one task per confirmed shot, grouped by a `generation_id`.
- Submission requires `accept_cost=true`, a ready H3 plan, and the current project revision. The submitted prompt, model, duration, audio policy, ordered media IDs, and input fingerprints are immutable task snapshots.
- Background processing uses `UniArtVideoModel`; it saves the upstream task ID immediately through `on_task_submitted`, then stores the downloaded video as an indexed `generated_video` media record.
- A user can cancel pending or processing tasks. Cancellation stops local publication; it cannot retract a provider request already accepted upstream.
- This slice supports the verified H3 recreation contract only. Seedance remains rejected until its recreation prompt/reference contract is verified by code and tests.

## Boundaries

- Final multi-shot FFmpeg assembly is a separate local task described in
  `2026-09-20-recreation-assembly-v1.md`; generation submission only creates
  durable per-shot outputs.
- No automatic retries or duplicate paid submissions. A task with a saved provider ID resumes; a task without one is marked failed after an interrupted worker rather than silently resubmitted.
- Provider request URLs and credentials are never stored in the task payload.

## Success criteria

1. A ready H3 plan can create one durable task per shot only with explicit cost acceptance.
2. Task creation rejects stale revisions, missing references, invalid fingerprints, and non-ready plans.
3. A mocked UniArt adapter receives the exact prompt, ordered references, duration, and audio flag; its provider task ID is persisted before completion.
4. Successful output is indexed and returned through the owner-signed media path.
5. Cancellation prevents a late provider result from becoming a media record.
6. Foreign owners cannot read or cancel tasks.

## Verification

- `pytest tests/test_recreation.py -q`
- New mocked generation task tests in `tests/test_recreation.py`
- `npm run typecheck`
