# Mobile voice latency tracing

## Request and boundaries

Measure the actual mobile capture → SenseVoice → text Agent → OpenTalking → UniArt → Ali Qwen → WebRTC path. Do not infer that TCP dominates from the transport configuration alone.

One random trace ID follows each captured segment through the voice queue, chat operation, returned turn and TTS command/session. No transcript, audio, SDP or credentials enter diagnostic events. Timings use monotonic clocks within each process; never subtract client/server wall-clock timestamps.

## Measured intervals

| Interval | Evidence and limits |
| --- | --- |
| Utterance ending → segment flush | Current code waits 0.9s of quiet; estimate from the configured gate, not measured actual speech endpoint |
| segment_ready → asr_sent | Client recognition queue |
| ASR HTTP round trip | Mobile upload, network, proxy, multipart parsing, server work and response delivery |
| ASR total_ms / inference_ms | Existing SenseVoice handler and decode timers; handler starts after multipart parsing |
| ASR round trip minus handler | Unattributed upload/network/proxy/parsing/response overhead; **not** pure network latency |
| chat_enqueued → chat_dequeued | Browser workflow queue |
| chat HTTP round trip | Includes server routing/model/tool/storage and network |
| coordinator / host_planner / cloud_qwen / chat_total | Request-scoped server phase timings; cloud interval includes UniArt and upstream generation, not just Ali latency |
| playback_enqueued → playback_dequeued | Browser speech queue |
| tts_sent → tts_accepted | OpenTalking HTTP acceptance, not generated audio |
| tts_sent → audio_energy | TTS generation, media queue, transport and decoded non-silent audio; excludes chat time and does not prove speaker audibility |
| webrtc_stats | Selected nominated pair RTT; inbound audio jitter and lifetime average jitter-buffer delay where browser exposes them |

Original ICE events cover cold connection setup. Existing OpenTalking logs provide TTS first PCM and first WebRTC queue markers and session correlation. Browser command/session markers link those logs to a turn. Missing stages stay missing, never zero-duration success.

## Outstanding provider boundary

UniArt → Ali requires provider/gateway correlated request telemetry to split precisely. This slice does not change UniArt or provider routing. Cloud model duration is an aggregate; do not attribute it solely to Ali or cross-region network.

## Verification and deployment

22 Python tests passed (chat/diagnostic validation and context-reset/error propagation); 16 UI tests passed (capture, recovery, command correlation, diagnostics omit transcript). Typecheck and static build passed.

Demo only, backed up backend and HTML; old hashed assets retained. No timeout, VAD thresholds, TURN or TTS provider change in this slice. Fresh mobile reload and natural speech are required for runtime measurements; synthetic host tests are not mobile latency evidence.

Filtered log collection: `docker logs --since 10m --timestamps iframe-companion-demo 2>&1` followed by filtering `Companion voice diagnostic` and `Companion latency` only. Feed into `scripts/opentalking/summarize_voice_latency.py`. Results may arrive out of order, so join by trace ID and compare event elapsed times, not log arrival times.

## UDP comparison and connection reuse slice

Mobile UDP sample: selected-pair RTT 66ms, jitter 0ms, lifetime jitter-buffer average 38ms. Previous TCP sample was 2971/69/312ms. Different requests/times, not a controlled causal comparison. UDP remains selected in Demo; original configuration retained on host.

Code facts: chat used top-level requests.post (temporary Session); each TTS synthesis used a temporary AsyncClient; browser opened media only when a reply was queued. Changes: thread-local chat Session, process-local asynchronous TTS HTTP pool with shutdown close, and preconnect on active capture. No model/provider/timeout changes or automatic model request retry. Auth stays per request; cookies are discarded. TTS pool is shared across ephemeral adapters, since the runner closes its per-turn adapter after speech. It is closed by the unified application lifespan after runners stop.

Success criteria: listening opens media without submitting TTS; later reply reuses media; unmount releases media; chat connections reuse within a worker without carrying request credentials/cookies; HTTP failures are not replayed; TTS client reuses across adapters and closes on service shutdown. Actual latency benefit requires fresh mobile samples after deployment.

## Coordinator output boundary repair (2026-10-31)

Observed: actual mobile coordinator phases were 3005.7/3003.6ms against a 3s read timeout; aggregate phase status 'ok' only means the best-effort caller returned, not a valid model decision. Host/container synthetic hello reached the service in ~0.2s, ruling out a universal host reachability failure. Model logs show repeated 120-token completions; a synthetic full-context request returned irrelevant context instead of a decision. Specific mobile timeout outcomes were swallowed, so their exact upstream response is not retrospectively proven.

Code facts: dict context was converted to Python repr and then parsed as JSON, losing local task state; unconstrained model output could exhaust 120 tokens; invalid focus was silently replaced with chat. Patch preserves typed JSON context, requires enum-constrained JSON schema using deployed llama-server support, rejects incomplete/invalid decisions, and keeps the existing deterministic command behavior and client timeout. No added fallback or reduced timeout.

Regression: original service fails typed-context/invalid-output tests; patched service passes all 3 tests. Direct real-model synthetic calls returned valid chat/reply in 880/598/635ms. Reloaded service with original environment/user; host health passed. Mobile latency benefit remains to be measured.
