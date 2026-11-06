# Material date review and reversible deletion

## Observed

The retention page filters only the loaded page by title/type and provides no deletion. Its inventory merges generation history, image-edit copies and registered uploads. Cross-product references have not been reconciled, so physical deletion is not authorized by this inventory.

## Contract

- Review by month and numbered day (1–31), with direct date selection and an all-dates option. Use the browser's local day boundaries, including DST. Display day counts, newest first and date group headings; unknown dates remain a separate group under all dates.
- Temporary title/type/date filters run before pagination on the backend, and expose total/day counts for all matching temporary records. New selections discard old pages and stale responses.
- Saved materials and trash are fully fetched, then filtered with the same local-day rules.
- Delete means move to an owner-scoped recycle bin, after confirming the specific item. A persisted tombstone hides only that temporary or saved-list entry; file content, exact-version reads, generation history, project references, saved copies and version lineage remain intact. No file purge or automatic cleanup is enabled. The confirmation explains this boundary.
- The recycle bin supports restore and shows deletion time. Failed operations leave the item visible and retryable. Trash operations are idempotent, isolated by authenticated owner, and reject IDs not present in that owner's inventory or collection.
- Reading inventory, collection or an empty trash must not initialize or migrate storage. A corrupt trash store must fail closed rather than silently showing deleted items again.

## Affected paths and validation

Playground inventory/API, a small tombstone store, material-library client, retention browser and focused tests. Verify filters before pagination, local-day midnight/DST bounds, unknown dates, owner isolation, persistence/idempotence, restore, corruption behavior, pagination races and preserved content/version reads. Run relevant pytest/UI suites, frontend typecheck and production build.
