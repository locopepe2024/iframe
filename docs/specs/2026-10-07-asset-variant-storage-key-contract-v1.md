# Asset Variant Storage Key Contract v1

## Decision

An asset variant has one durable media identity: `storage_key`. It identifies
material in the configured storage backend and is independent of the browser
delivery URL.

- `storage_key`: persisted asset truth; local output key or COS/OSS object key.
- `url`: compatibility/read projection only. It may be a delivery URL in an
  API response and must never be used as durable reference state.
- signed URLs, preview URLs, and provider URLs are runtime projections.

## Boundaries

1. Asset creation and migration populate `storage_key`.
2. Asset indexes and owner validation compare `storage_key` only.
3. API signing operates on a response copy and may populate `url` without
   mutating persisted models.
4. Agent requests resolve an owner-scoped asset/variant identity before
   producing a provider URL. Arbitrary URLs do not establish ownership.
5. Legacy records with only `url` are read as `storage_key` during migration;
   they remain readable until the store is next persisted.

## Success criteria

- New `ImageVariant` instances always expose a non-empty `storage_key`.
- Asset index entries use the canonical storage key internally.
- A signed delivery URL is never written back to a variant model.
- Agent accepts an owned variant regardless of local/object-key backend and
  rejects foreign or unindexed material.

## Verification

- `python3 -m pytest -q tests/test_agent_chat.py src/apps/comic_gen/test_asset_reference_index.py`
- `python3 -m py_compile src/apps/agent_api.py src/apps/comic_gen/models.py`
