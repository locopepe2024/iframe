# Companion realtime voice validation — 2026-10-24

Implemented native Qwen audio dialogue through UniArt `qwen-audio-3.1-realtime-plus`. Chat microphone starts a consented realtime session with server VAD, 16 kHz PCM input, 24 kHz PCM output, streaming transcription, manual/voice interruption and explicit end. Image/video microphone remains browser dictation. No voiceprint or continuous background listening.

Identity/channel: authenticated HTTP issues a 45-second one-use capability. Browser sends capability in first WS frame; no credential in URL/browser payload. Server fixes model/session settings and only permits bounded audio input and interruption. One active session per owner, five-minute session cap, no automatic paid retry. Tickets are process-local; demo uses a single worker. Raw audio is not stored. Transcript is currently transient in the voice panel and is not written to saved conversation or diary. No action tools are exposed; saving and other actions remain in text/card workflow.

Verification:
- Backend regression suite: 24 tests pass, including native relay, ticket consent/expiry/replay, wrong origin, PCM validation, owner-scoped media and chat behavior. Changed native transcription field handling was rechecked with the three realtime backend tests.
- Frontend regression: 34 UI tests passed; an additional native ASR field test was subsequently added, and all five hook plus five composer tests passed. Two audio codec/playback unit tests pass. Covers resampling across chunk boundaries, signed little-endian output, explicit start, uncertain mic permission cancellation, stop/error/hidden/unmount cleanup and interrupted audio suppression.
- Final isolated static export passes with `/companion-demo` prefix. Full TypeScript check still reports only the two existing `ReferenceCandidate.description` errors in CharacterWorkbench.tsx:404 and :1275. No errors in changed Companion sources. Unrelated worktree changes excluded.
- Demo adapter/router imports pass. Installed exact Nginx location `/companion-demo/companion-agent-api/companion-runtime/realtime` with HTTP/1.1 Upgrade headers and 330-second timeouts; unrelated proxy routes preserved. Nginx configuration test succeeds (existing duplicate HTTP server-name warning remains). Backup: `/etc/nginx/garage.uniart.fun.before-companion-realtime`.
- Public WS handshake returns 101, then rejects an invalid one-use ticket with code1008. This check invokes no paid provider.

Pending runtime evidence: no real microphone/speaker or paid Qwen provider dialogue has been exercised by this consumer. Browser echo cancellation, interruption quality, upstream permission and actual latency need testing with the user's configured personal channel. Session transcript persistence and voice-to-action cards remain later slices.

Local implementation commits: a8c1f35b, 6291a4ab, 250ec90a. No push or merge performed.

## Follow-up: reported connection close

Runtime observation: original demo log shows ticket success and downstream WS acceptance, then an upstream ConnectionClosedError about46 seconds later. The earlier log recorded no close code/frame count, so root cause cannot be recovered from that entry. This does not prove a microphone or credential failure.

Using the configuration associated with that reported session, verified native session.created/session.updated. Full public demo path then accepted two seconds, followed by a separate50-second continuous PCM silence test without disconnection. A local nonprivate synthetic phrase (“你好，今天我很开心。”) subsequently completed a real round trip: speech started/stopped,5 ASR delta events, final ASR, response.created/done,15 response transcript deltas and13 audio chunks totaling245760 PCM bytes. Raw reply audio was not saved. These observations establish current provider/relay functionality, not the historical cause or device microphone/playback quality.

Added bounded diagnostics (exception class, received/sent close codes, elapsed time, input frame count and last event type; no keys/audio/transcript) and failure messages that identify upstream authentication, access, throttling or timeout when supported by the exception. Unknown upstream interruption no longer tells the user to troubleshoot a microphone. Regression:26 related backend tests pass. Need a repeat from the affected browser to locate an intermittent or device-specific failure; no alternate provider/retry path added.

## Follow-up: playback stutter

Code fact: playback previously used only20 ms scheduling headroom. It now schedules the first chunk200 ms ahead and keeps following chunks contiguous. If playback drains mid-response, resumed audio gets200 ms headroom again. This is a scheduling cushion, not a minimum accumulated audio duration. Longer network/provider stalls can still cause gaps; the historical stutter cause is not established.

Four audio unit tests and ten hook/composer tests pass, including deterministic jitter, rebuffer metrics, normal completion exclusion and immediate interruption cleanup. Isolated static export passes; TypeScript still reports only the two existing CharacterWorkbench errors above. Session-end console diagnostics contain underrun count, maximum arrival gap after queue drain (excluding the added cushion), and configured startup buffer; no audio/transcript. No paid provider test was repeated for this browser-only change. Affected-browser listening remains required to assess improvement.

Deployed chunks before replacing the nested companion/agent.html, retaining previous chunks. Public HTML matches the built artifact (SHA256 dd65de0032b184129758671101e6efc9fd0f92b66215785d01909fccd34ac117); all11 referenced scripts return success.

## Follow-up: actual buffered audio

User runtime observation: reply text arrives but audio remains choppy after the200 ms change. This does not establish whether the stream is delayed before browser arrival or during playback. Tests reproduced that the previous implementation starts scheduling small chunks without accumulating audio, restarts each small chunk after depletion, and fails to bound an oversized incoming chunk.

Changed startup/rebuffer to wait for600 ms of decoded audio before scheduling, with50 ms scheduling lead only when the timeline has drained. Once scheduled, chunks remain contiguous even when less than50 ms remains. Completion flushes short replies; pending audio counts toward busy state and the15-second limit, and interruption discards it. Session-end diagnostics now also include received audio duration and maximum inter-chunk arrival interval, excluding normal response boundaries and interruption. No raw audio or text is recorded by these diagnostics. Increased startup delay is intentional; sustained arrival slower than playback or stalls longer than the reserve can still exhaust it.

Six audio tests and ten hook/composer tests pass. Four new behavioral tests failed against the prior implementation before the fix. TypeScript reports only the existing two CharacterWorkbench errors. Actual listening improvement remains pending user verification.

Isolated static export passed and was deployed chunks-first without backend changes. Public HTML and the changed audio-containing chunk match local build bytes: HTML SHA256 a5a4c806e68493c569605e715cae3115dbccd219496de314a0ea5efd2ed138cc; chunk9270.d0f2abdac09c05e1.js SHA256 76a86e001d5b640f9e1978c4f3b2a9e1b1d112917969637de28d6087d8290d1e.
