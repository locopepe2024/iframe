# Batched storyboard draft recovery

## Problem and evidence

The initial storyboard path currently sends an entire episode to one model call and
requires one JSON response containing every frame. A production episode with about
5,291 source characters returned malformed JSON, then exhausted the 30-minute job
window during its full-episode retry. This is a runtime observation, not evidence
that any particular batch size guarantees quality or latency.

## Scope and assumptions

- Preserve the episode's narrative coverage and the reviewed-draft apply boundary.
  The user has not yet requested a target frame count.
- Split initial analysis at source offsets. These offsets prove text coverage and
  ordering, not scene boundaries or semantic coverage.
- Keep model calls sequential so the next batch can use a bounded summary of the
  preceding batch. Do not treat this as proof of continuity quality.
- Store each completed batch under the owner, project, and request fingerprint.
  A failed or restarted job can reuse only batches for the same fingerprint.
- Refinement of a whole draft is a separate problem; it remains unchanged here.

## Contract

1. A short source continues through the existing single-call path.
2. Long sources are partitioned into deterministic, contiguous source ranges.
3. Each valid batch result is saved before the next model request. Repeated jobs
   with the same fingerprint skip saved batches and return frames in source order.
4. A late worker from an expired job cannot overwrite a newer batch result.
5. No partial batch list is applied to the project's formal storyboard. Errors
   remain explicit and the completed batches remain available for retry.
6. Each draft frame carries a source range for review and recovery; applying
   the draft does not turn that range into a fabricated scene reference.
7. The job status reports completed and total batch counts while running.

## Success criteria

- Tests prove contiguous range coverage, ordered combination, same-fingerprint
  resume after failure/restart, and isolation from a changed request.
- The complete reviewed draft still passes through the existing apply API.
- Existing storyboard and extraction job tests pass.

## Affected paths and verification

- `src/apps/comic_gen/llm.py`: batch splitting and bounded previous context.
- `src/apps/comic_gen/pipeline.py`: sequential draft orchestration.
- `src/apps/comic_gen/extraction_jobs.py`: durable batch checkpoints.
- `src/apps/comic_gen/api.py`: connect the job fingerprint to checkpoints.
- `tests/test_storyboard_analysis_jobs.py`, `tests/test_extraction_jobs.py`.
- Run targeted pytest, frontend typecheck if the API contract changes.
