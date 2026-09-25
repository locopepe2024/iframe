# Asset generation model resolution v1

## Observed

- The current image catalog makes `uniart/gpt-image-2` the visible T2I
  default and marks older Wan image SKUs as unavailable to the selector.
- The Cast workbench already resolves a project's saved T2I model through the
  live catalog before submitting a generation task.
- The legacy Consistency Vault and asset-library variant action previously sent
  the raw saved project model, so older projects could still submit a retired
  model id.
- The legacy failure alert discarded `status.error` because its translation
  string had no interpolation slot.

## Direct implication

- All frontend asset-generation entry points need one T2I resolver.
- Retired/unknown project model ids are submitted as the current visible
  catalog fallback, while a current selected id is preserved.
- Failed tasks must show the backend/provider detail when one exists.

## Not yet proven

- This explains the reported production failure only if the affected project
  retained an unavailable model id or the provider rejected that route. A live
  task id or provider response is still required to prove the exact upstream
  cause.

## Boundaries

- This change only normalizes the frontend submission value; it does not
  rewrite persisted project settings or publish model-catalog changes.
- It does not submit a real paid generation as part of verification.

## Success criteria

1. Cast, legacy asset, and project asset-library generation use the same T2I
   resolver.
2. An old `wan2.7-image-pro` project value resolves to
   `uniart/gpt-image-2` in the current catalog.
3. A failed task alert includes `status.error` when present.
4. Catalog tests, frontend typecheck, and production build pass.

## Verification commands

```bash
cd frontend
npm run test -- --run
npm run typecheck
npm run build
```
