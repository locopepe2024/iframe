# Director profile edit propagation v1

## Scope

Manual edits to Director profile fields must remain visible to downstream
storyboard and asset consumers after draft save and Director confirmation.

## Contract

- `continuity_constraints`, `prohibitions`, and `unresolved_questions` are
  execution guardrails, not script facts.
- `setting`, `timeline`, and story-map time anchors are director context. They
  may describe a user decision, but must not be treated as source evidence
  unless linked to the confirmed fact ledger.
- Saving a draft persists the edit only; confirming the Director revision makes
  it eligible for downstream consumers.
- The bounded execution summary must include a deterministic current-edit
  section so an older model-generated summary cannot hide newly saved fields.
- Existing generated frames are not rewritten; confirmation marks downstream
  work for review according to the existing Director lineage rules.

## Verification

- Normalize a profile with an existing `execution_summary` and newly edited
  continuity constraints, unresolved questions, year/era setting, and timeline.
- Assert `director_execution_payload()` contains those current edits.
- Run `tests/test_director_profile.py`.
