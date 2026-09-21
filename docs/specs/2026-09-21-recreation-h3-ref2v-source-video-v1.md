# Recreation H3 Ref2V source-video boundary v1

## Observed

- The recreation generation worker currently snapshots ordered image inputs,
  but sends no `ref_video_urls` to the UniArt H3 adapter.
- The H3 prompt compiler currently validates `videos=0`, so the prompt does
  not name the source video as a provider input.
- The UniArt adapter accepts local media only after publishing it through the
  configured COS/OSS uploader. A local filesystem path is not an HTTP(S)
  provider input.
- Recreation source media already has an owner-scoped path and SHA-256
  fingerprint, and the worker already rejects changed image fingerprints.

## Direct implication

- The current recreation path is not yet a true source-video Ref2V request;
  source-video analysis is not the same as sending the source video to H3.
- Each paid generation task must snapshot the source media ID and fingerprint,
  validate them again immediately before provider submission, and send the
  source as the single ordered `ref_video_urls` input.
- The H3 prompt must contain `<Video 1>` and pass the offline contract checker
  with `videos=1`. The source frame remains `<Picture 1>` and an optional
  replacement remains `<Picture 2>`.
- Local disk is valid only as processing storage when an externally reachable
  signed media URL is configured. Otherwise COS/OSS must publish the file;
  neither path may silently be sent to the provider as a local filename.

## Not yet proven

- This change proves request shape and input integrity only. It does not prove
  H3 visual motion preservation, replacement fidelity, audio quality, or
  provider acceptance for every deployment SKU.
- It does not add OpenPose, Depth, Edge, ControlNet, or other unverified
  control fields.

## Hypotheses

- H3 will preserve more of the original camera/action trajectory when the
  source video is supplied as an explicit Ref2V input rather than represented
  only by sampled frames and prose.

## What would verify it

1. Prompt-contract tests prove `<Video 1>` and `videos=1`.
2. Worker/provider mock tests prove `ref_video_urls` contains the registered
   source and that a changed source fingerprint fails before submission.
3. Storage tests prove COS/OSS or a configured public disk URL is required for
   local references, while HTTP(S) references remain pass-through.
4. With administrator-provided COS credentials or public media base URL, run
   one non-automatic, cost-gated UniArt preflight and record only request shape,
   provider task status, and output fingerprint.

## Scope and success criteria

- Scope: recreation prompt contract, durable generation task snapshot, worker
  provider arguments, and media-reference resolution.
- No database migration is required; task payloads are JSON snapshots and new
  fields are backward-compatible for pre-existing tasks.
- No ControlNet or 3D white-model data enters the H3 request.
- Existing cost-consent, provider-task recovery, owner, revision, and assembly
  boundaries remain unchanged.

## Verification commands

```bash
pytest -q tests/test_recreation.py tests/test_recreation_prompt_contract.py tests/test_uniart_video_urls.py
pytest -q
```
