# Episode Scene and Prop Asset Rebinding V1

Status: implementation contract. Date: 2026-10-10.

## Observed

The confirmed episode plan cites Scene and Prop asset IDs that no longer exist
in episode, series, or personal-library scope. Sync currently retains those IDs
as suggested bindings, and the Assets view labels them "awaiting generation"
although there is no asset on which generation can run.

## Contract

- A plan `scene_id` identifies a plan node. Only `scene_asset_id` (including a
  shot scene binding) identifies a Scene asset. A `prop_id` identifies a Prop
  asset. These source IDs remain unchanged in confirmed plan revisions.
- The episode stores explicit replacement maps from old plan Scene/Prop asset
  IDs to current asset IDs. Projection uses the current ID for asset-facing
  context and shot references. It never changes historical plan snapshots or
  existing storyboard revision pins.
- Sync reuses an existing asset or explicit replacement. A missing source ID
  does not authorize creating an asset. Explicit deletion retires its plan
  source IDs; repeated sync does not recreate deleted assets.
- A user may replace the mapping with an available episode or series asset.
  No name matching establishes identity automatically.
- The Assets UI groups requirements by the one current effective asset ID.
  Historical plan asset IDs are compatibility keys and must not appear as
  separate rows, choices, labels, or asset names. Replacing a grouped asset
  updates all source IDs represented by that row in one validated operation.
- A plan scene with no explicit asset ID remains an unresolved requirement and
  does not acquire an asset merely because its plan `scene_id` exists.
- The UI must distinguish no asset ("awaiting association") from an attached
  empty asset ("awaiting generation").

## Verification

Test creation, repeated sync, deleted replacement recreation, explicit
replacement, plan immutability, and shot projection for both Scene and Prop.
Verify an unbound plan scene remains unbound.
