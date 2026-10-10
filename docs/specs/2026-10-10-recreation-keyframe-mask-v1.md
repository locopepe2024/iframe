# Recreation keyframe mask v1

## Observed

- UniArt's AtlasCloud GPT Image 2.5 edit route forwards a mask; the GPT Image 2 route currently drops it.
- Recreation keyframe tasks submit two image references without a mask.
- Recreation uploads only reference and replacement images.

## Assumptions and scope

- A caller supplies a PNG mask at the source frame's exact pixel dimensions. Mask pixel semantics remain provider-owned and need a real edit probe.
- This slice adds an optional mask to one corrected-keyframe task. It does not generate masks, edit video frames in bulk, or infer action events.
- Existing unmasked tasks retain their current request contract.
- Masked tasks use a subject-replacement prompt that preserves source pose, sword and foot positions; provider compliance remains unverified.
- Only an owner-scoped image uploaded to the same project can be used as a task mask.

## Success criteria

1. UniArt forwards JSON and multipart masks for GPT Image 2 edits without changing unmasked edits.
2. Recreation rejects a missing, foreign, non-PNG, or dimension-mismatched mask before creating a paid task.
3. A task records the mask ID and fingerprint, rechecks them at execution, and passes the mask path to UniArt.
4. The recreation UI can upload a PNG mask and submit it with a corrected-keyframe task.
5. Targeted UniArt, recreation backend, and frontend tests pass. A paid provider probe is separate.

## Affected paths and verification

- UniArt: `relay/channel/openai/adaptor.go`, `relay/channel/openai/image_edit_test.go`.
- iFrame: `src/apps/recreation/{api,service}.py`, `frontend/src/lib/recreation.ts`, `frontend/src/components/modules/recreation/ShotReferences.tsx`, related tests and translations.
- Verify with targeted `go test`, `pytest`, frontend typecheck and component test.
