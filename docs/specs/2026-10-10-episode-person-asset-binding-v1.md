# Episode Person to Character Asset Binding V1

Status: implementation contract. Date: 2026-10-10.

## Observed

The confirmed plan stores narrative `person_id`. The current series assets have
new Character IDs, while the active Director story map has no people. The old
story map refers to deleted Character IDs. Sync cannot infer an existing asset
by name. Automatic empty-asset creation was retired after it produced duplicate
assets and erased the distinction between missing and intentionally deleted.

## Contract

- Store an explicit `person_id -> character asset_id` choice on the episode.
- The choice applies to current and future projections of that same narrative
  person; it does not rewrite a confirmed plan or a prior storyboard pin.
- A choice must reference a person in the current confirmed plan and an
  available Character asset in the effective episode scope.
- Legacy plans can carry narrative person IDs in `shot.character_ids` with an
  empty `cast_bindings` list. An explicit choice maps those IDs to current
  Character IDs in the projected shot; the saved plan stays unchanged.
- A stale plan revision is rejected before changing the choice.
- If no valid candidate remains, sync leaves the person unbound. Repeated sync
  reuses a valid binding; deletion retires that binding and never creates a
  replacement. Old plan revisions and storyboard pins remain historical.
- Force-deleting a series Character clears episode person bindings to its ID.
  The current asset requirements view omits stale historical handoff bindings;
  confirmed plan snapshots remain available for audit.
- Users can replace or clear a choice. Sync groups the resulting shot and scene
  requirements under the selected asset ID.
- Explicit choices take precedence over Director story-map and base-ID
  inference. They do not assign a Character ID by matching names.
- Historical Director display names may label a person in the UI, but do not
  establish an asset match or alter the saved plan.

## Verification

Sync an unresolved person and verify it remains unbound across reloads. Delete
an explicitly bound Character and verify repeated sync does not recreate it.
Bind a current series Character and verify the confirmed plan and old pins are
intact.
