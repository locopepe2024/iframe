# Plan Continuity and Entity Re-extraction V1

Status: partial runtime implementation; extraction identity reconciliation is a
target design, 2026-10-11. See
`2026-10-11-episode-entity-director-plan-asset-view-contract-v1.md` for the
end-to-end view and storyboard contract.

## Observed

- Shooting-plan scene IDs and asset IDs have different meanings. Place/time
  continuity IDs and reviewed lighting baselines now exist in plan runtime
  data; their presence does not prove that generated images or video obey them.
- Entity extraction builds a fresh Script with new entity IDs. Applying it
  replaces the extracted entity collections as intended by the asset identity
  contract. Confirmed shooting plans and extraction results therefore have
  different asset ID namespaces after re-extraction until explicitly rebound.

## Contract

1. A plan scene may carry explicit `place_continuity_id` and
   `time_continuity_id`. These are reviewed narrative joins, not asset IDs or
   conclusions from similar text. Legacy plans without them remain readable.
2. A plan may record one reviewed lighting baseline per place/time pair. A
   shot in that pair inherits the baseline unless it has an explicit override
   reason. Conflicting nonempty shot lighting without that reason is rejected
   at plan confirmation and asset handoff. The plan revision pins the baseline
   snapshot.
3. The editor exposes the IDs and baseline for review. Generated plan text may
   suggest continuity, but only confirmed structured values establish a join.
4. Current re-extraction creates fresh Scene and Prop IDs; this is the runtime
   behavior to replace, not the target identity rule. Resolve mentions within
   one extraction, then compare candidates with current live assets. A
   confirmed `same_as_existing` decision keeps the asset ID and advances its
   revision; `new_entity` receives a new ID; ambiguity stays `needs_review`.
   The confirmed plan remains immutable. Sync reports unresolved historical
   references and accepts reviewed current-asset choices. Similar names alone
   never establish identity.

## Verification

- Confirm and reload a plan containing two views of one place/time pair;
  verify IDs and baseline persist and projected shots inherit the same light.
- A conflicting shot with no override is flagged; an explicit override reason
  survives confirmation and projection. Legacy plans remain valid.
- Re-extract an existing episode with a confirmed plan. Under current runtime,
  verify fresh Scene/Prop IDs leave plan requirements visible. For the target
  resolver, verify `same_as_existing` preserves IDs, `new_entity` allocates
  IDs, and ambiguous groups stay pending review.
- Run targeted backend and frontend tests, typecheck, build, and diff checks.

## Boundaries

- No automatic name-based identity merge, asset generation, or rewriting of
  confirmed plan revisions.
- No claim that a shared continuity ID alone proves a rendered clip matches
  the baseline. Rendered output quality requires visual review.
- Video task creation does not yet compare prompts, storyboard lighting, or
  generated pixels with the plan baseline. A future pre-render validation
  failure must identify affected scene and shot IDs and must not silently
  rewrite creative lighting.

## Affected Paths

- `src/apps/comic_gen/models.py`, `pipeline.py`, and asset handoff API.
- Shooting-plan editor/types and episode asset picker.
- Focused shooting-plan, reparse, and UI tests.
