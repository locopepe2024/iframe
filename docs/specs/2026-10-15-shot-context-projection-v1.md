# Rich-frame shot context projection v1

## Scope and evidence

Code fact: `_episode_shot_context_prompt` slices serialized JSON at 6000 characters.
A long description can therefore remove closing JSON syntax and later identity fields.
This slice changes only the shot-context handoff to rich-frame refinement. Asset variant
context, global director context, persistence, and other LLM entry points are excluded.
No visual continuity or production rollout is claimed by these tests.

## Contract

- Prefer the frame's saved snapshot; never replace a conflicting snapshot with a newer plan.
- A snapshot with an explicit shot ID different from the frame is suppressed. Legacy
  snapshots without a shot ID remain usable only with an explicit binding-status marker.
- Without a snapshot, select only the exact frame shot ID and its scene from episode context.
- Allowlist scene, shot, lighting, dialogue, and provenance fields. Do not send arbitrary
  dictionaries. A lighting baseline must match both place and time continuity IDs.
- Emit valid JSON of at most 6000 Unicode characters (prefix excluded). Crop prose before
  serialization, successively reducing per-field limits. List fields contain at most eight
  entries. Preserve selected identity/provenance strings verbatim; reject malformed or
  oversized identity values rather than changing their meaning. If fixed identity data
  cannot fit, suppress this context. Never cut serialized JSON.
- Include projection version, origin, text limit, and whether content was shortened.
  Missing legacy provenance is null; never borrow current script versions for a snapshot.
- Existing saved snapshots are not rewritten. New snapshot provenance expansion is deferred.

## Success criteria and verification

Tests must first reproduce invalid JSON on long escaped/Unicode input. Then verify valid
bounded deterministic output, saved provenance, unknown legacy metadata, exact lookup,
cross-shot rejection, unknown-field exclusion, matching baseline, and the actual refinement
LLM boundary. Run focused tests and the repository backend CI selection. Submit an independent
PR for admin review; do not deploy or merge.

Affected paths: `pipeline.py`, new `shot_context_projection.py`, focused backend tests.
