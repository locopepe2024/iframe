# Interactive Entity Analysis V1

Status: implementation in progress.

## Observed

- Entity analysis is an owner-scoped asynchronous job and returns a structured
  draft containing characters, scenes, and props.
- The confirmation modal only permits apply or discard. Users cannot explain a
  correction or ask the analyzer to revise its draft.
- Applying a draft replaces the current Cast, so an analysis response must never
  mutate the project before explicit confirmation.

## Direct Implication

Transport durability does not provide interaction. The analysis flow needs a
revision turn that includes the source script, current structured draft, and the
user's accumulated correction instructions.

## Contract

- A refinement turn accepts a non-empty natural-language instruction.
- Every turn sends the original script, current draft, and all accepted user
  instructions so later turns do not silently lose earlier constraints.
- The model must return the same structured entity schema; prose-only responses
  fail explicitly and leave the current draft unchanged.
- Refinement runs as an owner/project-scoped asynchronous job and uses the same
  polling/recovery behavior as initial extraction.
- The UI shows the user's revision history and updated entity counts.
- Apply remains the only operation that mutates project Cast. Discard removes the
  draft and its local conversation history.
- Refinement cannot trigger media generation or modify assets.

## Success Criteria

- A user can request corrections such as merging duplicate roles, adding aliases,
  excluding background extras, or expanding product descriptions.
- A successful refinement replaces only the pending draft.
- A failed refinement preserves the prior draft and exposes the upstream error.
- Cross-owner task reads remain rejected.
- Existing one-shot extraction and apply flows continue to work.

## Evidence Limit

Request-capture and UI tests prove context forwarding, state transitions, and
mutation boundaries. They do not prove that every semantic instruction will be
followed by the selected model; that requires evaluation cases against real scripts.
