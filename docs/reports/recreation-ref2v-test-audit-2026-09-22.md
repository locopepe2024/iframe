# iFrame Recreation H3 Ref2V test audit

Date: 2026-09-22

Scope: source-video Ref2V request construction, immutable input validation,
local disk/COS publication boundaries, cost gating, and regression coverage.

## Observed

### Code facts

- Recreation generation plans now compile H3 prompts with `<Video 1>` and
  validate the offline prompt contract with one video input.
- Each durable generation task snapshots `source_media_id` and
  `source_fingerprint`. The worker re-reads the owner-scoped source record and
  bytes, verifies both fingerprints, and sends the source in
  `ref_video_urls` together with ordered `ref_image_urls`.
- Local files are not put directly into the UniArt JSON request. The adapter
  requires an uploader-generated HTTP(S) URL. An iFrame deployment may instead
  set `UNIART_MEDIA_BASE_URL`; this converts indexed owner media into a
  short-lived signed `/studio/media` URL at the configured public origin.
- No ControlNet, OpenPose, Depth, Edge, pose-control, or 3D white-model field
  was added to the generation request.
- `GET /user/config` now reports only a non-sensitive
  `runtime_uniart_available` boolean. It is true for either an owner-scoped
  encrypted key or an explicitly enabled shared runtime key; it does not copy
  or expose the shared key as personal configuration.
- Browser development now sends API requests through Next's same-origin
  `/api-proxy`. This preserves the anonymous browser-profile cookie across
  upload, analysis, and polling. Explicit API overrides, Tauri, and production
  same-origin resolution retain their existing routing behavior.
- The legacy embedded 3D white-model reference was removed from Recreation.
  The separate 3D Director workbench and its rigged GLB assets remain intact.

### Runtime observations

- A non-paid local HTTP preflight used
  `/private/tmp/iframe-h3-pilot-20260921.mp4` as the source:
  - registration: HTTP 201;
  - analysis: `review`, 15.083333 seconds, 362 frame PTS values, one candidate
    cut, one audio stream;
  - timeline confirmation: HTTP 200, two shots;
  - both source-frame bindings: HTTP 200;
  - H3 generation plan: HTTP 200, `ready=true`, no blockers;
  - plan mapping: `h3_picture_video_labels`;
  - both prompts contained `<Video 1>` and `<Picture 1>`;
  - paid submission with `accept_cost=false`: HTTP 422 with the expected cost
    acceptance error. No provider task was submitted.
- Current local environment inspection found no configured
  `UNIART_MEDIA_BASE_URL`, Tencent COS credentials, or Alibaba OSS bucket and
  endpoint. This is a deployment configuration state, not evidence that either
  publication mode is defective.
- The reload-enabled backend was intermittently unavailable around the first
  upload attempt. A no-reload server completed the same workflow. The exact
  reload trigger was not instrumented, so attributing the interruption to
  `output/` file changes remains unproven.
- A real headless-browser workbench run at `#/recreation` observed:
  - no required personal-configuration modal when shared runtime credentials
    were available;
  - source upload HTTP 201 and visible `已登记` state;
  - analysis submission HTTP 202;
  - terminal `review` state with 362 analyzed frame PTS values;
  - no page exceptions;
  - before the polling optimization, four distinct signed source URLs produced
    nine cancelled browser media requests as project status refreshed;
  - after preserving the current source URL through the automatic analysis
    lifecycle, the same run used one signed URL and produced three cancelled
    requests for that URL. The media remained visible and analysis completed;
    the remaining cancellations are recorded as browser observations without
    assigning a cause.
- Before the same-origin change, the same browser script reproduced upload
  HTTP 201 followed by analysis HTTP 404 `Recreation project not found`.
  Backend access logs showed a valid analyze route, and the client used
  cross-origin Axios without credentials; the anonymous owner cookie therefore
  did not persist to the analysis request.

### Automated verification

- Backend targeted Ref2V tests: 124 passed, 1 skipped.
- Backend full suite after workbench fixes: 648 passed, 1 skipped.
- Frontend logic tests: 177 passed.
- Frontend UI tests: 195 passed after removing the obsolete white-model test.
- Frontend typecheck: passed.
- Frontend production build: passed. Next static-export rewrite warnings remain
  non-failing and pre-existing.
- `git diff --check` and Python compileall: passed.

## Direct implication

- The recreation path now has a code-verified source-video Ref2V request shape,
  rather than using the source only for local analysis.
- A source mutation after paid task creation fails before provider submission.
- Local disk can be used only when the deployment exposes the signed Studio
  media route through a provider-reachable HTTPS origin. Otherwise COS/OSS is
  required for local source and reference files.
- Cost consent remains a hard gate and was exercised through the HTTP API.
- Shared runtime credentials no longer falsely trigger the personal-key gate,
  while the settings UI can still distinguish whether a personal key exists.
- Anonymous local workbench ownership now remains stable across the ordinary
  multi-request recreation workflow in browser development.
- Analysis polling no longer replaces `<video src>` whenever a freshly signed
  representation of the same source arrives. Manual refresh and reopening a
  project still obtain a current signed URL.

## Not yet proven

- No paid H3 Ref2V task was submitted in this audit. Provider acceptance,
  polling, download, and visual output are therefore not runtime observations
  for the new recreation path.
- Motion, camera, action, light, identity, clothing, prop replacement, hand
  occlusion, text fidelity, and audio quality have no statistical support yet.
- The local disk public-origin path was tested with a mocked HTTPS origin and
  signed URL contract, not from the external UniArt network.
- ControlNet capability remains unverified and intentionally absent.

## Hypotheses

- Explicitly attaching the source as `<Video 1>` should improve motion and
  camera preservation relative to the earlier image-only recreation request.
- The observed dev-server interruption may be related to reload activity, but
  process/reloader logs are required before treating that as root cause.

## What would verify it

1. Configure either the four server-side Tencent COS variables or an externally
   reachable `UNIART_MEDIA_BASE_URL` with a stable signing key.
2. Submit one explicitly approved, low-cost H3 task and record the redacted
   request shape, provider task ID, terminal status, output probe, and SHA-256.
3. Compare output against the source with a fixed scorecard for camera path,
   action timing, lighting, identity, replacement fidelity, and occlusion.
4. Repeat representative cases before making any reliability or percentage
   claim.
5. Instrument the reload-enabled backend if the upload-adjacent connection
   interruption recurs; inspect watcher events and process exits before fixing
   the launcher.
