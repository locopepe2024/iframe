# H3 Agent prompt and editor reference normalization

## Observed

The Playground H3 compiler rejects any prompt containing both canonical media labels and editor @ references before resolving attachment names. Agent IR output contains `<Picture N>` labels; adding a selected reference mention triggers this rejection before provider submission.

## Required boundary

Normalize resolvable editor attachment names and ordinals to canonical media labels even when canonical labels already exist. Existing canonical numbers refer to modality-specific submitted slots and must remain unchanged. `<Subject N>` and `[Shot N]` remain business text. Preserve attachment ordering and draft text. Do not infer absent attachments, renumber existing canonical labels, or bypass ambiguity, unresolved-name and bounds validation. Upstream receives canonical syntax only.

## Success criteria / affected paths

- `src/models/reference_binding.py`: deterministic normalization followed by existing bounds checks.
- `src/models/test_reference_binding.py`: reproduce mixed canonical/editor failure; cover shortened labels, modality ordering, ambiguity, unknown names and out-of-range labels.
- `tests/test_reference_submission.py`: exercise I2V service submission with Agent-style IR and an appended shortened mention; verify canonical-only provider text and unchanged original draft.
- Run targeted pytest and compile checks. No paid provider request or deployment is required; visual adherence and deployed behavior remain unverified.

## Verification results

- Before the fix, 9 reference-binding cases failed at the blanket mixed-syntax rejection.
- After the fix, all 13 binding tests and the mocked I2V provider-submission regression passed (14 total). Compile and whitespace checks passed.
- Broader reference submission run: 21 passed, 3 failed. The same 3 failures reproduced with the HEAD compiler restored temporarily: second-image I2V rejection, text-reference insertion, and invalid UTF-8 reference handling. These pre-existing failures are outside this syntax-normalization slice; no claim of a fully green submission suite.
- No real provider request, deployment, or output-quality verification performed.
