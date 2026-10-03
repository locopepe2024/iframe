# iframe branch consolidation v1

## Baseline

The consolidation baseline is `feature/recreation-six-stage-workflow` at
`32793900`. The historical branches `feature/storyboard-batched-drafts` and
`deploy-series-director` are not merge bases for the baseline and must not be
merged as whole branches.

## Rules

1. Preserve both historical tips with local archive tags before closing the
   development branches.
2. Build the integration branch from the current baseline.
3. Import only commits or files whose behavior is not already present in the
   baseline. Prefer the smallest coherent feature slice.
4. Do not import generated release metadata, unrelated documentation, or
   historical branch-only refactors unless a selected feature requires them.
5. Resolve conflicts in favor of the current baseline, then reapply only the
   selected behavior with tests.
6. Do not modify `uniart`, `uniflow`, or `uniroute`.

## Current branch evidence

- `feature/storyboard-batched-drafts` contains the older storyboard batching,
  recovery, WebP, and provider-capability work.
- `deploy-series-director` contains most of that storyboard history plus the
  director, assets, H3 reference, and 3D work. Its tip does not include the
  final storyboard provider-resolution fixes.
- A direct merge into `32793900` produces conflicts in current Agent, asset,
  ResultCard, director, and project-management files.

## Success criteria

- The integration branch starts at `32793900`.
- Each imported slice has a source commit/file list and targeted verification.
- No unrelated branch-drift files enter the integration branch.
- The two development branches can be closed after the integration branch is
  verified; archive tags remain for audit and rollback.

## Initial integration result

The following storyboard capability slice has been imported cleanly onto the
current baseline:

- provider-supported video resolution selection
- UniArt capability-based resolution lookup
- catalog-supported aspect-ratio submission
- catalog-supported 720p preference

Source commits: `9269ded5`, `ceb763ee`, `19d33483`, `2bafd9e2`.

Frontend typecheck and `tests/test_recreation.py` pass on this slice.

The director deployment branch was not imported as a whole. Its feature files
depend on older overlapping API, store, and model definitions; a whole-tree
replay produced duplicate declarations and was discarded. Director features
remain queued for separate contract-sized slices.
