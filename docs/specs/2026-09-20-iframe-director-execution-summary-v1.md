# iFrame Director Execution Summary V1

## Status

Implementation specification for the Director profile downstream-context cutover.

## Observed

- **Code fact:** `DirectorProfile` stores narrative, timeline, relationship, event,
  style, continuity, prohibition, unresolved-question, and sample-plan fields in
  one editable object.
- **Code fact:** storyboard analysis, asset generation, and video/R2V prompt
  polishing currently receive a serialized copy of the whole confirmed profile.
- **Runtime observation:** a real Director response was observed at roughly
  18.7 KB, so the full object is materially larger than the downstream design
  context needs.

## Goal

Keep the full Director profile as the review/audit source while exposing a
bounded, execution-oriented context as the only Director context sent to
downstream design and generation prompts. The context has two layers: a
global summary for cross-scene invariants and a compact local memory for
scene-level state transitions. A single global paragraph is not sufficient
for a long script whose causality crosses scene boundaries.

## Contract

1. `DirectorProfile.execution_summary` is a generated or user-reviewed string
   capped at 7,000 characters by default. The effective limit is configurable
   with `IFRAME_DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS` and clamped to
   1,000–16,000 characters. It contains cross-scene facts and stable
   directing constraints only.
2. The Director analysis/refinement prompt must return and refresh this field.
   It must contain only source-grounded decisions needed by asset and storyboard
   design: setting, story beats/relationship changes, visual/performance/sound
   direction, continuity constraints, prohibitions, and unresolved questions.
3. `DirectorProfile.scene_summaries` contains bounded local memory entries.
   Each entry has a stable source `scene_ref`, a local event/state summary,
   `state_in`, and `state_out`. The scene reference is a source marker or
   extracted scene name; it is not silently replaced with a generated asset ID.
   The local-memory projection has its own 3,200-character item and character
   budget. With the default, the two bounded layers are capped at 10,200
   characters before JSON/prompt framing overhead.
4. If a legacy profile has no summary, the backend builds a deterministic,
   bounded projection from the existing fields. This is a compatibility path,
   not a claim that the projection is semantically equivalent to an LLM summary.
   If a legacy profile has no local entries, the projection may fall back to a
   single global entry; downstream prompts must treat that entry as a fallback,
   not as scene-specific evidence.
5. The downstream envelope contains only `revision`, `content_hash`,
   `execution_summary`, and bounded `scene_summaries`. It must not contain
   `timeline`, `sample_plan`, or the other full-profile fields.
6. Storyboard prompts must match a source scene marker to `scene_ref` when one
   exists, use `state_out` → `state_in` as the preferred transition memory, and
   fall back to the global summary when no match exists. They must not invent a
   local state to fill a missing entry.
7. The full profile remains available to the Director editor and refinement
   request. Applying a profile persists the summary together with the full
   profile and keeps the existing revision/hash/review semantics.
8. The analysis/refinement prompt imposes a compact source budget: bounded
   timeline/relationship/event/sample-plan item counts and concise field
   values. This is an output-shaping measure; it does not replace the summary
   contract or silently truncate persisted user edits.

## Boundaries

- This slice does not delete or rewrite the full Director profile.
- This slice does not add a second summarization LLM request; the summary is
  requested in the existing Director response and has a deterministic legacy
  fallback. This keeps latency and waiting behavior bounded without hiding a
  failed summary call behind fallback prose.
- This slice does not yet split storyboard generation into one LLM request per
  scene. Local memory is first made explicit and bounded; request partitioning
  requires a separate segmentation/latency decision.
- This slice does not change model/provider routing or storyboard schemas.

## Success criteria

1. New Director responses expose a bounded `execution_summary` suitable for
   medium-length (roughly 5,000–7,000 character) scripts.
2. New Director responses expose bounded local scene memory with transition
   state, and legacy profiles remain valid with a deterministic fallback.
3. Storyboard and asset/video prompt contexts contain the two-layer envelope
   but no full-profile arrays.
4. The full profile remains editable and hash/revision behavior remains stable.
5. Tests cover global/local bounds, legacy compatibility, scene matching
   contract text, and downstream exclusion.

## Verification

```bash
cd /private/tmp/iframe-assets-release
pytest -q tests/test_director_profile.py
pytest -q tests/test_storyboard_analysis_jobs.py
git diff --check
```
