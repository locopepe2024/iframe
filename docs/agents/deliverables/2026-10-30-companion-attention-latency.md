# Name-only voice attention latency

## Observed

- An existing name-call turn completed about 9.8 seconds after its server claim. The UI displays `正在处理…` while the chat operation is busy.
- The demo startup wrapper sets the read-only coordinator URL inside Python; inspecting only Docker environment variables does not reveal it.
- Two read-only probes of the configured personal chat channel took 5.22 and 6.45 seconds with full tools and recent user messages. Setting `enable_thinking=false` did not improve this pair of observations; no model parameter change was deployed.
- Recent OpenTalking synthesis logs showed approximately 0.96–1.64 seconds to enqueue the first audio/video chunk. These are separate turns, not a complete trace of the reported name call.

## Change and boundary

Commit `49d4e333` acknowledges complete default-name utterances (`小安` / `小安小安`, allowing punctuation) with `我在，您说。` before calling the coordinator, planner or main model. The existing turn lifecycle persists the exchange and serves retries idempotently. The existing OpenTalking speech path receives the response as before.

Commands containing additional words, ASR approximations, selected-photo operations and active editor dictation retain their original handling. This narrow attention protocol does not change a creative task or introduce a broader keyword intent router. Custom browser-configured names are outside this change.

## Verification and deployment

- First integration reproduction failed because the coordinator was still called; after the fix, 49 tests passed across attention, chat, interaction focus and planner runtime.
- Only `api.py` and the new `voice_attention.py` were deployed to the existing independent demo source mount. The original API hash matched the parent commit before replacement. Backup: `/tmp/companion-attention-49d4e333/api.before.py` on the host.
- Restarted only `iframe-companion-demo`; public health returned `ok`. Health's `source_revision` still reports the original release label `57811135`; the deployed patch is `49d4e333`.
- Three fresh-identity HTTP tests on the host returned the expected acknowledgement in 15, 13 and 13 ms. Retried requests returned identical turns. These measurements exclude recognition, public-network transit and audio playback.
- No frontend build, production service changes, push or merge. Real microphone-to-speaker acceptance remains for the user's browser. General conversational/model latency remains separate work.
