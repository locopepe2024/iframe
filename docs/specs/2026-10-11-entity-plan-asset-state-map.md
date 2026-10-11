# Entity, Shooting Plan, and Asset Sync State Map

Status: code inventory for PR #84, 2026-10-11. This describes the current
runtime contract, not a claim about any specific user's project data.

## Identity Owners

| Data | Owner and identity | Meaning |
| --- | --- | --- |
| Extracted Scene / Prop | `Script.scenes[]` / `Script.props[]`, `id` | Current project asset entity. Its image-generation status is separate. |
| Planned scene | Confirmed plan `scenes[]`, `scene_id` | One planned narrative scene; not an asset ID. |
| Planned asset reference | `scene_asset_id`, `prop_ids`, shot bindings | Historical asset IDs recorded in the confirmed plan, or absent for an unbound requirement. |
| Episode choice | `episode_scene_asset_replacements`, `episode_prop_asset_replacements`, `episode_plan_scene_asset_bindings` | Explicit mapping from a plan source ID or unbound scene/shot requirement to a currently visible asset ID. |
| Projected context | `episode_visual_context` | Recomputed scene, shot, character, and prop requirements from the latest confirmed plan plus current choices. |
| Sync record | `episode_asset_bindings[]`, keyed by type and asset ID | Reviewable handoff record; it is neither the asset entity nor generated media. |

## State Transitions

| Action | Writes | Does not establish |
| --- | --- | --- |
| Extract preview | Short-lived server cache and frontend review state | Project assets, plan references, or media. |
| Apply extraction | Replaces the project's extracted entities with fresh IDs; preserves confirmed plan revisions | A match between old plan IDs and new entities, even when names match. The new `Script` does not carry the previous projected context or episode binding maps. |
| Confirm shooting plan | Appends a plan revision with its source asset references and narrative constraints | New Scene / Prop entities or generated images. |
| Sync from plan | Recomputes and persists context and binding records; reports unresolved requirements | Entity extraction, name-based matching, image generation, or acceptance of a candidate reference. |
| Choose an existing asset | Stores an explicit episode mapping, then resyncs | A rewrite of the confirmed plan or a new asset entity. |
| Generate asset media | Changes media and generation state on an asset | A plan binding unless separately selected. |

`new_bindings`, `reusable_bindings`, `changed_bindings`, and `stale_bindings`
count sync records relative to the previous projected context. `reusable`
means that a record's scene/shot usage and context signature did not change;
it does not mean that an asset image was generated or reused. `unresolved_bindings`
contains missing current asset IDs, unbound scene/shot requirements, and
unresolved character mappings. Its length is a count of requirement entries,
not unique missing assets; one scene can contribute several shot entries.

`EpisodeAssetBinding.status` is `suggested`, `accepted`, or `stale`.
`suggested` is a candidate handoff reference, not `GenerationStatus.PENDING`.
The current sync path creates `suggested` records and carries forward an
existing `accepted` status when the context is unchanged. The inspected code
does not expose an action here that changes a suggested record to accepted.

## Diagnostic Order

1. Check the extraction preview counts. A preview alone does not update the project.
2. After Apply, inspect current `Script.scenes[]` and `Script.props[]` by ID. Their presence proves entity application, not media generation or plan binding.
3. Inspect the latest confirmed plan's `scene_asset_id`, `prop_ids`, and shot bindings. Old IDs remain historical references after re-extraction.
4. Sync and inspect `unresolved_bindings` by `asset_type`, `reason`, `scene_id`, `shot_id`, and `asset_id`; do not infer a unique missing-asset count from its length.
5. For a missing old plan ID, choose a current visible asset explicitly. For a plan scene with no asset ID, bind the scene or shot requirement. Sync again and verify the projected context points to the chosen current ID.

## Evidence Boundary

Code and tests establish these transitions. Without the affected project's
stored Script and extraction response, they do not establish whether a
particular extraction returned Scene/Prop rows, whether Apply completed, or
which requirement produced a reported unresolved count.
