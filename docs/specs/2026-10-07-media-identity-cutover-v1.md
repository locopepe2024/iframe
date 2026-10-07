# Media Identity Cutover v1

## Objective

Before episode production testing, every persisted Studio material reference
must use a stable owner-scoped `media_id`. Browser URLs and provider URLs are
delivery projections only.

## Scope

- `output/projects.json`
- `output/series.json`
- `output/library_assets.json`
- owner media registries under `output/users/*/media-registry.sqlite3`
- image variants, video variants, storyboard reference packages, and video task
  lineage fields

## Migration Rules

1. A durable local/output or COS/OSS key is registered idempotently for its
   owner and receives a `media_id`.
2. Existing signed/provider URLs are not accepted as durable identity. The
   migration must resolve them to an owned storage key or fail the record.
3. Existing `url` fields are rewritten to storage keys in persisted models;
   signed URLs are regenerated only in API responses.
4. Storyboard references without a resolvable `media_id` are reported and the
   cutover fails. They are not guessed or silently dropped.
5. Every migration writes timestamped backups before replacing any store.
6. The migration is idempotent and produces a JSON report with counts and
   rejected record locations.

## Cutover Gates

- zero missing `media_id` on persisted image/video variants
- zero URL-only confirmed Storyboard references
- every `media_id` resolves in the matching owner registry
- source and migrated stores parse through current Pydantic models
- production backup and report are retained

## Rollback

Restore the timestamped store backups and media registry backups as one unit,
then deploy the previous release SHA. No in-place partial rollback is allowed.

## Verification

```bash
python3 scripts/migrate_media_identity.py --root output --check-only
python3 scripts/migrate_media_identity.py --root output --apply
python3 -m pytest -q tests/test_media_registry.py tests/test_media_identity_migration.py
```
