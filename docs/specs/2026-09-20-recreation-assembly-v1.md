# Recreation final assembly v1

## Observed

- A confirmed recreation timeline contains ordered source PTS intervals.
- Each submitted generation creates one durable task per timeline shot and, on
  success, one owner-scoped `generated_video` media record.
- The provider output duration is independent of the source shot duration; the
  selected generation duration is only a lower-bound preflight input.

## Direct implication

- Final assembly must use the confirmed timeline order, not task creation order.
- Every generated clip must be probed before assembly. A clip at least as long
  as its source interval may be cropped to that interval; a shorter clip is an
  explicit failure and must not be silently stretched or looped.
- `silent` assembly removes generated audio. `generated` assembly requires an
  audio stream in every generated clip. `preserve_source` removes generated
  clip audio and extracts each original source audio interval by the same PTS
  boundaries before muxing the concatenated audio.
- The output is published only after all inputs, fingerprints, durations and
  FFmpeg outputs have been verified. It is indexed as a new `final_video`
  media record and retains the source, generation, shot task and fingerprint
  metadata.

## Not yet proven

- UniArt's provider output codec, frame rate and audio layout are not fixed by
  the local contract. Assembly therefore normalizes each segment through the
  local FFmpeg runtime instead of relying on stream-copy compatibility.
- No claim is made that generated speech or sound effects are semantically
  correct; this slice only preserves or concatenates the returned tracks.

## Boundaries

- Only the verified `uniart/minimax-h3-vip` recreation generation path can
  produce assembly inputs today.
- Assembly is local and does not create another paid upstream request.
- Cancellation prevents publication after the current FFmpeg stage; a running
  FFmpeg process is allowed to finish because no time-based worker cutoff is
  introduced.
- A worker interruption leaves a durable failed task for explicit retry; it is
  never re-submitted to UniArt implicitly.

## Success criteria

1. Assembly creation rejects stale revisions, missing shots, incomplete or
   mismatched generation groups, changed fingerprints, and unavailable source
   audio for `preserve_source`.
2. A successful assembly has one normalized segment for every confirmed shot,
   in timeline order, with no segment longer than its requested target.
3. A shorter generated segment fails with a user-visible duration error.
4. `silent`, `generated`, and `preserve_source` produce the documented audio
   policy; no policy silently falls back to another one.
5. The final output is indexed as `final_video` and is owner-scoped.
6. Cancellation and foreign-owner checks are covered by tests.

## Verification

- `pytest tests/test_recreation.py -q`
- `npm run typecheck`
- `npm run test:ui -- src/components/modules/recreation/ShotReferences.test.tsx`
