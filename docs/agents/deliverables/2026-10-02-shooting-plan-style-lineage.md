# Shooting plan style lineage boundary

## Observed

The shooting-plan record stores `effective_style_hash` alongside source and
Director interpretation lineage. The API and panel currently compare every
lineage key when deciding whether a draft or confirmed revision is stale.

## Decision

Visual style is downstream generation context. It is recorded on each plan so
the generation context remains auditable, but changing the current style does
not invalidate an existing shooting plan, its draft, or its confirmation.

## Stable lineage

Only these fields gate plan validity and confirmation:

- `source_revision`
- `source_revision_id`
- `director_profile_revision`
- `director_profile_hash`

`effective_style_hash` remains available for generation fingerprints and
historical inspection. A new shooting-plan generation may use the current
style; an already generated plan keeps the style snapshot it was generated
with.

## Success criteria

1. Changing only the style hash leaves draft/current plan stale flags false.
2. Changing source or Director lineage still marks the plan stale and blocks
   confirmation.
3. The style hash remains serialized in plan and revision summaries.
4. Existing asset persistence behavior is unchanged by this isolated fix.

## Verification

- `pytest -q tests/test_director_shooting_plan.py`
- `cd frontend && npm run typecheck`
- targeted panel test (the repository test runner does not include component
  tests outside `src/__tests__`).
