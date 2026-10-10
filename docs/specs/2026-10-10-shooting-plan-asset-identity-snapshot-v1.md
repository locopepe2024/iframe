# Shooting Plan Asset Identity Snapshot V1

## Observed

The confirmed plan for episode `3df50e54-0390-4334-b5a3-db01988afdb8` cited
10 Character, 5 Scene, and 6 Prop IDs that existed in its Series on 2026-10-06.
Those IDs are absent from the current Series. Sync treated them as unknown and
created empty episode assets, losing the original names and descriptions.

## Contract

- A confirmed plan revision records the identity (type, ID, name, description)
  of each available asset it references at confirmation time. This is an
  immutable description snapshot, not a second asset or an image revision.
- Deleting or replacing an asset does not alter a confirmed plan or its
  snapshot. A later sync that must create a new asset from a missing reference
  uses the snapshot's name and description. It does not restore images or
  silently equate a different current ID with the old ID.
- Unregistered asset IDs have no identity snapshot. Existing legacy plans
  without snapshots remain readable; their missing identity requires
  historical evidence rather than guessed names.
- Plan scene IDs are plan nodes, not asset IDs. Only scene asset references
  appear in the snapshot.

## Verification

Confirm a plan, remove its source assets, sync, and verify replacement assets
retain names and descriptions while historical plan and storyboard references
stay unchanged. Verify repeat sync is idempotent and legacy revisions load.
