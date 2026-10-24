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
