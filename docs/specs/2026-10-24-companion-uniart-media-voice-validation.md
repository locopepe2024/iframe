# Companion UniArt adapter: 2026-10-24

## Available in isolated demo

- More → UniArt channel: owner-specific encrypted key and HTTPS API URL. Existing personal settings remain read-only; saving a blank key preserves/copies the existing personal credential into demo-local settings.
- Guided image/video setup → explicit model catalog fetch → explicit paid submission → job polling → image/video result.
- Shared UniArt adapters; video audio remains disabled. Resolution uses catalog default when supplied. Basic duration/aspect validation.
- Explicit Qwen HTTP TTS (`qwen-audio-3.0-tts-flash`, `longanhuan_v3.6`) and native audio playback controls. Existing browser dictation is separate.
- Durable owner-scoped generation receipts and operation IDs; same request retries reuse receipt. Uncertain running jobs are not automatically resubmitted.

## Verification and evidence

- Backend: 21 related tests pass, including adapter execution/result ownership, idempotency, encrypted config and binary speech validation.
- Frontend: 25 related tests pass, including explicit submission, stable operation on uncertain retry, manual audio synthesis and resource cleanup.
- Isolated HEAD + task-only overlay static build passes with `/companion-demo` prefix. Full TypeScript check reports two pre-existing errors in CharacterWorkbench.tsx:404 and :1275 (`ReferenceCandidate.description`), none in changed Companion sources. Live workspace also has unrelated in-progress Storyboard syntax changes; excluded from build.
- Isolated demo adapter/API imports succeed; demo container restarted. Public `/channel` returns configured=false for a fresh anonymous identity; `/channel/models` returns expected 409 asking for personal key.
- Public agent HTML SHA256 equals isolated output: d0e876836ac6eb1c65a22391e57a7fbcd0912a47e4a8f1fa8450c50a7eec88e1. Chunks uploaded before nested `web/companion/agent.html`; existing chunks retained.
- No real paid image/video/audio provider call made in this consumer. Provider behavior remains to be validated with the user's configured channel.
- Local commits a167c678 and 1ff33170; no push/merge.

## Remaining work

- Reference-photo generation: authorize and implement private media transport before enabling i2i/i2v/f2v/omni.
- Native Qwen realtime dialogue: authenticated WebSocket bridge, PCM microphone capture/playback, interruption, connection lifecycle and budget controls. HTTP TTS alone does not implement this.
- Generation history/recovery UI across reload or mode switching. Current receipt is durable on backend but current UI keeps job/operation only in mounted component state. Do not promise UI cancellation of provider work.
- Provider acceptance tests with actual personal credentials, then mobile browser interaction verification.
