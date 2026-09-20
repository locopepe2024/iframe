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
bounded, execution-oriented summary as the only Director context sent to
downstream design and generation prompts.

## Contract

1. `DirectorProfile.execution_summary` is a generated or user-reviewed string
   capped at 3,200 characters.
2. The Director analysis/refinement prompt must return and refresh this field.
   It must contain only source-grounded decisions needed by asset and storyboard
   design: setting, story beats/relationship changes, visual/performance/sound
   direction, continuity constraints, prohibitions, and unresolved questions.
3. If a legacy profile has no summary, the backend builds a deterministic,
   bounded projection from the existing fields. This is a compatibility path,
   not a claim that the projection is semantically equivalent to an LLM summary.
4. The downstream envelope contains only `revision`, `content_hash`, and
   `execution_summary`. It must not contain `timeline`, `sample_plan`, or the
   other full-profile fields.
5. The full profile remains available to the Director editor and refinement
   request. Applying a profile persists the summary together with the full
   profile and keeps the existing revision/hash/review semantics.
6. The analysis/refinement prompt imposes a compact source budget: bounded
   timeline/relationship/event/sample-plan item counts and concise field
   values. This is an output-shaping measure; it does not replace the summary
   contract or silently truncate persisted user edits.

## Boundaries

- This slice does not delete or rewrite the full Director profile.
- This slice does not add a second summarization LLM request; the summary is
  requested in the existing Director response and has a deterministic legacy
  fallback. This keeps latency and waiting behavior bounded without hiding a
  failed summary call behind fallback prose.
- This slice does not change model/provider routing or storyboard schemas.

## Success criteria

1. New Director responses expose a bounded `execution_summary`.
2. Legacy profiles without the field remain valid and produce a bounded
   fallback summary.
3. Storyboard and asset/video prompt contexts contain the summary envelope but
   no full-profile arrays.
4. The full profile remains editable and hash/revision behavior remains stable.
5. Tests cover summary bounds, legacy compatibility, and downstream exclusion.

## Verification

```bash
cd /private/tmp/iframe-assets-release
pytest -q tests/test_director_profile.py
pytest -q tests/test_storyboard_analysis_jobs.py
git diff --check
```
