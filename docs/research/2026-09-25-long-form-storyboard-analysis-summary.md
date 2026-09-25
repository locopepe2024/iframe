# Long-form analysis and storyboard generation: status summary

Date: 2026-09-25. Working branch: `feat/storyboard-batched-drafts`;
implementation commits: `0d3278d8` and `41b8540e`; published baseline:
`e9ee20c2`. The branch is local and has not
been deployed or tested against a live model in this work session.

## Observed

- **Runtime observation (earlier incident):** one episode had about 5,291
  source characters. The first UniArt `gpt-5.6-sol` response arrived after
  about nine minutes with malformed storyboard JSON. The complete-episode
  retry then encountered a client timeout, HTTP 504, SDK retry, and the
  30-minute application job limit. The job ended `failed`. This observation
  needs a new request trace to confirm behavior on the current service.
- **Code fact (published baseline):** initial analysis sent the whole episode
  and requested the complete `frames` array in one model response. A parse
  failure retried the whole request. Draft refinement still sends the source,
  current draft, and cumulative instructions in one request.
- **Code fact (this branch):** sources over 1,800 characters are split into
  deterministic contiguous ranges of at most 1,800 characters. Calls are
  sequential; each receives up to three prior frames as bounded handoff.
  Completed batches are stored in SQLite by owner, project, fingerprint, and
  index. A retry can reuse matching checkpoints. The UI polls completed/total
  batch counts. Formal project frames change only after draft review and apply.
- **Code fact:** Director long-source analysis is a separate map/reduce path
  with source-linked notes and a bounded downstream profile. Its limits and
  cache do not by themselves protect storyboard draft/refinement output size.
- **Code fact:** the apply API accepts 1-200 draft frames. Each of the three
  episodes with more than 100 shots is below that limit if its count stays
  under 200, but a model result above 200 would fail at apply.

## Direct implication

- The new initial-analysis path reduces the amount of source and requested
  output per call and preserves completed batches across worker failure or
  process restart. It does not make a partial draft an approved storyboard.
- The 30-minute job deadline still applies to the entire sequence. Slow
  batches may exhaust it; a late worker cannot save another checkpoint after
  expiry. Retry may still overlap a provider call that is already in flight.
- A whole-draft refinement of 100+ frames remains a large single output and
  retains the original completeness/timeout risk.
- Character-offset coverage proves that input ranges were sent in order. It
  cannot prove all story beats, dialogue, character variants, or spatial
  continuity appear correctly in generated frames.

## Not yet proven

- Lower failure rate, shorter elapsed time, lower total cost, or better output
  quality on the actual three episodes. Local tests use mock model responses.
- That an offset boundary is a scene boundary, or that a three-frame handoff
  preserves continuity across episodes.
- That an embedding/vector index improves retrieval over scoped IDs and
  source references for the current three-episode workload.

## Hypotheses and improvement direction

1. Evaluate initial analysis on the three episodes: record per-batch source
   range, input/output size, duration, retry count, frame count, parse outcome,
   and full-job result. Compare against the earlier single-call incident.
2. Move refinement to targeted scene/range edits with explicit affected frame
   IDs, preserving untouched frames. Avoid another full-episode response for
   a small director instruction.
3. Add a review gate for source coverage, dialogue order, temporal character
   variant, and cross-batch state. These are candidate checks, not proven
   automatic quality guarantees.
4. Treat series assets, episode source ranges, confirmed Director canon, and
   selected media versions as versioned knowledge records. Build a task graph
   from a frozen context snapshot to batch drafts, review, apply, and render.
   Start retrieval with scoped IDs and revisions; evaluate semantic ranking
   only after measuring misses. Generated drafts remain unconfirmed evidence.
5. Define a product policy for episodes that legitimately exceed 200 frames
   before changing the apply limit or silently reducing shot coverage.

## Next tests

- Simulate a multi-batch 5,291-character episode, fail after one checkpoint,
  recreate the job store, retry, and verify that only missing batches are
  generated and the ordered draft remains unapplied. **Completed locally:**
  the test confirms one call for batch one, two for failed/retried batch two,
  one for batch three, contiguous source ranges, and unchanged formal frames.
- Apply a reviewed draft of 120 frames and verify frame order and zero model
  calls. **Completed locally.**
- Verify progress across failure/retry and reject stale-worker checkpoint
  writes after timeout. **Completed locally:** checkpoint saves expire the job
  even without a status poll and reject the late write.
- Run a supervised live-model test on a representative episode, if authorized;
  inspect source coverage and output quality manually before any deployment.

## Verification so far

- Backend: 59 targeted tests passed (extraction jobs, storyboard jobs, Director
  profile). Frontend: 7 storyboard client tests, typecheck, and production
  build passed. These results verify code behavior, not live-model quality.
- Commits: `0d3278d8` (batched draft checkpoints), `41b8540e` (progress UI).
