# Series model settings: saved episode defaults

## Observed

On main `60d6a909`, `update_series` changes only the series record. Existing source-local regression `test_series_model_update_preserves_episode_override` fails: an episode value equal to the old series default stays unchanged after the series default changes. Some consumers read saved episode settings; other consumers and GET project use current series settings directly. There is no explicit per-field model inheritance provenance. Equality does not establish user intent.

## Bounded compatibility policy

This slice synchronizes saved defaults when the series is edited. For each changed ModelSettings field, update a member episode only when its saved value equals the previous series value. Preserve every differing episode value. This is a documented legacy compatibility rule, not proof that matching values were inherited or that differing values are honored by every runtime consumer. No historical bulk migration or equality-based provenance labels. An explicit override equal to the old default cannot be distinguished in the legacy schema; explicit inheritance/override metadata and a unified effective-settings resolver remain separate work.

Only episodes listed by the series, pointing back to that series, and belonging to the same owner may be updated. Apply changed fields only; preserve unrelated settings, tasks, frames and generated outputs. Copy settings to avoid aliasing between episodes and series. Update timestamps and save changed episodes under the existing pipeline save lock; unrelated series edits must not save projects. Accept validated ModelSettings objects or full dictionary records; reject malformed settings before mutation. Cross-file series/project persistence remains subject to the existing JSON store's lack of transactions.

## Verification

Reproduce the existing failure first. Add default-suite tests for field-level synchronization, preserved differing values, independent copies, repeated updates, owner/series membership isolation, persistence/reload, dictionary validation, and unrelated/no-op updates. Run source-local regression and relevant default backend tests, then the backend CI selection. No provider calls, local Go, production data edits or deployment.

Affected paths: pipeline.py, focused tests and this spec. Publish an independent PR; administrator merges. This slice does not claim an end-to-end fix for explicit episode model overrides.
