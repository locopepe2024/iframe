# Companion voice streaming and session recovery

## Evidence and scope

- Runtime: TTS first PCM took 2.5–8.7 seconds in sampled requests; no transport RTT measurement yet.
- Code: audio_speech WAV uses a buffered POST and only yields after the entire response.
- Runtime: a removed session continued receiving speak requests returning HTTP 404.
- TCP contribution to total delay is unproven. Keep ICE configuration unchanged in this slice.

## Implementation boundaries

1. Probe upstream WAV/PCM response timing using synthetic text. Do not log credentials or save audio. Do not assume raw PCM sample rate.
2. Where supported, decode response incrementally with explicit container/rate handling. Verify output parity, early output before EOF, truncation, and cancellation before deployment.
3. Close stale peer/events/audio resources on connection failure. A definitive speak 404 may recreate once and resubmit the same command; never automatically replay on ambiguous timeout or accepted speech failure.
4. Keep text replies and command ordering; avoid duplicate playback and session leaks. Preserve microphone and media ownership rules.

## Success criteria

- Measure upstream first-byte, first-PCM, EOF and WebRTC first-audio boundaries separately.
- Session 404 causes one bounded recreation; uncertain speak outcomes are not retried.
- Existing interrupt, autoplay and unmount tests continue passing.
- Back up deployed files, update Demo only, preserve TURN/OpenTalking configuration except any explicitly validated streaming adapter change.

## Affected paths and verification

- `scripts/opentalking/`: synthetic timing probe and reviewable external-source patch/tests.
- `frontend/src/components/companion/agent/OpenTalkingReply{,.test}.tsx`.
- `npm run test:ui -- src/components/companion/agent/OpenTalkingReply.test.tsx`; `npm run typecheck`; static Demo build.
- Run upstream probe and adapter behavior tests inside the CPU Mock dependency environment; smoke-test WebRTC after deployment.

## Validation and current deployment

- HTTP probe: WAV first byte 7178ms / EOF 7187ms; PCM first byte 4708ms / EOF 4717ms. These are single synthetic samples, not a controlled comparison. Neither response provided early audio.
- UniArt channel-23 API docs and adapter code expose `qwen3-tts-flash-realtime` through `/v1/realtime`; HTTP audio streaming is explicitly unsupported. No UniArt code was changed.
- Independent realtime probes yielded audio before response completion, with first PCM ranging 1.3–5.1 seconds in these samples. Both saved Demo voice choices worked when mapped to Cherry/Ethan in separate connections. Same-connection voice change timed out; the production UI recreates its connection when changing voice.
- Same-host WebRTC smoke passed: 35 audible frames, interruption tail peak 0, destroyed session closed.
- Subsequent public relay-only TCP smoke reached ICE completed and speak accepted, but the realtime adapter timed out waiting for session.updated (5 seconds) and produced no audio. The cause remains unproven. Independent event-only probes subsequently received session.created/session.updated and audio without error, so the failure is intermittent.
- Realtime default was **rolled back** to the previous HTTP WAV configuration. Compatibility patch remains dormant on the server. Do not declare realtime stable or enable it without resolving the intermittent handshake failure.
- Frontend expired-session recovery is deployed, 10 UI tests and typecheck passed; static build passed. No ambiguous request retry. No TURN/ICE changes.
- Next: capture timestamped session.created/session.updated/error/close events on the failing runner path, including concurrent sessions; distinguish missing/error acknowledgment from delayed acknowledgment. Do not widen timeout or enable automatic TTS regeneration as a substitute for diagnosis.
- TCP's contribution to audible latency remains unmeasured from an external mobile client. Same-host public relay testing is not mobile network evidence.

## Follow-up handshake diagnosis

- Added metadata-only handshake tracing: connecting/connected/update_sent/session.created/session.updated/error/closed, adapter correlation, elapsed milliseconds and error code. No audio, text, credentials or complete error bodies are recorded.
- Prepared realtime provider credentials without changing the HTTP default. Synthetic test sessions explicitly select realtime on every speak; default provider is not implicitly inherited for follow-up speak commands.
- A preliminary two-turn smoke accidentally used HTTP on its second turn. This was discovered from provider logs, corrected in the probe, and excluded from realtime multi-turn evidence.
- Verified public relay-only TCP: first run first audible 2496ms; corrected two-turn runs first audible 6671ms and 3553ms. Both corrected runs decoded audio in each turn, stopped after interrupt, and closed the session. These tests run from the host through its public endpoint and TURN, not from the user's mobile network.
- In traced successful requests, WebSocket connected in about 100ms; session.created arrived at 772–2805ms and session.updated at 1030–3207ms. No error event or handshake timeout was reproduced in these runs. Previously observed 5-second timeout remains unexplained; successes do not invalidate it.
- Diagnostic patch is active; default remains HTTP. No timeout extension, retry generation, UDP cutover, or claim of stable realtime rollout.
