# Recreation async lifecycle v1

## Observed

- `src/apps/recreation/service.py` currently expires analysis after a 600 second lease and keyframe tasks after a one hour lease.
- The frontend polls the analysis record, so a browser disconnect does not mean that the upstream or local worker stopped.
- A task that is still queued or processing must remain visible until it completes, fails because of an upstream/worker error, or is explicitly cancelled by the user.

## Decision

- Remove wall-clock expiry from recreation analysis and keyframe task records.
- Add an explicit owner-scoped analysis cancellation operation. Cancellation changes the record to `cancelled`; a worker that finishes afterward must not publish its result.
- Keep keyframe cancellation owner-scoped as a service/API operation so the same lifecycle rule is available to the UI and future task controls.
- Existing failed tasks remain retryable through the existing start/retry flow. A queued or processing task is not silently replaced by a second attempt.

## Boundaries

- This slice does not add video-generation submission or final FFmpeg assembly.
- Provider polling remains responsible for recognizing provider success, failure, or cancellation.
- Cancellation cannot retract a request already accepted by an upstream provider; it prevents local result publication and records the user cancellation.

## Success criteria

1. An old queued/analyzing record is still active when read; it is not rewritten to `failed` by elapsed time.
2. An owner can cancel its own analysis; another owner cannot cancel or read it.
3. A cancelled analysis cannot publish a late worker result.
4. Keyframe tasks do not become failed solely because their `updated_at` is old.
5. Existing ownership, revision, fingerprint, and retry tests still pass.

## Verification

- `pytest tests/test_recreation.py -q`
- `npm run test:ui -- src/components/modules/recreation/RecreationPage.test.tsx`
- `npm run typecheck`
