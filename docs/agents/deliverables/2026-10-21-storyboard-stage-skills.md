# Storyboard generation contract

## Scope and evidence
Code observation: confirmed shooting plans currently enter model context; coverage is not enforced. Prompt inclusion does not prove execution quality.

Two explicit workflows:
- auto (compatibility default): plan when a confirmed plan exists, otherwise script.
- plan: one confirmed shot becomes one initial frame without an LLM call. Full episode source only in this slice; no silent fallback. Preserve plan order, dialogue, assets, lighting and performance in shot context. Refinement may split a shot but may not omit, invent, reorder or merge shot IDs.
- script: existing script analysis plus optional storyboard-specific methods; never rerun upstream methods. Confirmed upstream context remains constraints.

Freeze stage selections before queueing; hash resolved mode, plan revision/hash and selected method revisions into job fingerprint. Persist provenance in frame lineage. Reject stale source/Director/facts/plan before refine/apply. Legacy unpinned drafts retain compatibility and are not claimed as plan conversions.

Success: plan initial count/IDs equal confirmed plan; missing/unknown/reordered IDs fail before persistence; stale plan fails; script methods reach analyze/refine prompts; review identifies workflow and coverage. No paid generation required for verification.

Affected: models, pipeline, API, LLM prompt boundary, stage catalog, storyboard dialog/client/review. No image/video provider changes.

Validation: pytest targeted storyboard/Director tests; frontend storyboard client/UI tests; npm run typecheck; npm run build. Deployment only after checks pass; no claim of authenticated browser acceptance.
