# H3 sample audio boundary v1

## Observed

- Code fact: iFrame already exposes an audio control for UniArt video models
  when the provider catalog includes a `supports_generate_audio` field. The
  value `false` does not remove the control; the normalizer deliberately keeps
  `params.audio=true` so the UI can carry the user's audio policy.
- Runtime observation: the completed MiniMax H3 pilot was submitted with
  `generate_audio=false` and returned a video containing an AAC stereo audio
  stream (`32000 Hz`, approximately `15.072 s`).
- Source-backed implementation fact: the H3 route has no provider-side silence
  toggle. `generate_audio=false` is therefore a request/capability field, not
  a proof that the downloaded media has no audio stream.

## Direct implication

- Audio capability is not a gate for the long-source Director/map-reduce path
  or for evaluating the Bookend sample. The sample may continue with the
  returned audio track.
- Media policy remains an assembly concern. The existing local assembly
  contract must be used to make the final result deterministic:
  `silent` removes generated audio, `generated` requires an audio stream, and
  `preserve_source` extracts the original source intervals.
- A provider capability value of `true` means the route is eligible for the
  audio-enabled product path; it does not eliminate the post-download media
  probe.

## Not yet proven

- The pilot audio stream alone does not prove that H3 produced semantically
  intentional speech, music, or sound effects, nor that `true` and `false`
  produce different tracks.
- One completed task does not establish stable behavior across all H3 route
  candidates or future provider revisions.

## Product decision

- Treat H3 as audio-capable for this sample and do not spend another paid task
  solely to prove silence.
- Keep the explicit `generate_audio` request in task snapshots for audit, while
  treating the probed output stream and the selected assembly `audio_policy` as
  the authoritative media behavior.
- Do not silently retry or reroute a paid task because the provider returned an
  audio stream when the request asked for `false`; local `silent` assembly is
  the deterministic opt-out.

## Verification

- Existing catalog tests cover both `supports_generate_audio=true` and the
  compatibility case where the field is `false`.
- Existing recreation assembly tests verify that `silent` emits no audio
  stream and that `generated`/`preserve_source` emit one.
- The pilot evidence is recorded in `/private/tmp/iframe-h3-pilot-20260921.json`
  and is not treated as a general provider guarantee.
