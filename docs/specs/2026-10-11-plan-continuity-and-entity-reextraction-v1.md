# Plan Continuity and Entity Re-extraction V1

Status: implementation in progress, 2026-10-11.

## Observed

- Shooting-plan scene IDs and asset IDs have different meanings. Plan location
  and time labels are text; no place/time continuity IDs or reviewed lighting
  baseline exist in runtime data.
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
4. Re-extraction intentionally creates new Scene and Prop asset IDs. The
   confirmed shooting plan remains immutable; sync must expose any old or
   unbound reference as a typed requirement and offer an explicit choice of
   the newly extracted asset. Similar names alone never establish identity.

## Verification

- Confirm and reload a plan containing two views of one place/time pair;
  verify IDs and baseline persist and projected shots inherit the same light.
- A conflicting shot with no override is flagged; an explicit override reason
  survives confirmation and projection. Legacy plans remain valid.
- Re-extract an existing episode with a confirmed plan. Verify Scene and Prop
  proposals receive new IDs and plan requirements remain visible until the
  user explicitly binds them to one of those IDs.
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
