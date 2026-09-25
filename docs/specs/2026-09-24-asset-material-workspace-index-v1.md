# Asset and Material Workspace Index Contract V1

Status: design contract; no runtime cutover implemented by this document.
Date: 2026-09-24

## Goal and Boundary

Define one authoritative lifecycle for materials, semantic assets, placements,
generation references, and effective indexes across personal workspaces,
projects, and series. Reserve tenant and membership boundaries for future teams.
This extends the existing asset/material/reference contract; it does not change
Playground, Storyboard, Recreation, or provider-specific reference syntax by
renaming their current request fields.

## Observed

- Studio stores `Character`, `Scene`, and `Prop` in project, series, and
  owner-filtered global library containers. The project asset index is an
  effective read projection with project > series > global ID precedence.
- Uploaded and generated files are not yet registered in one Studio `media_id`
  registry. `ImageVariant.url` is still the stored media locator.
- A generated image variant records stable asset/variant reference provenance.
  The generation task validates references at submit and resolves them again at
  execution, so deletion between those points can currently fail the task.
- Personal library deletion checks storyboard frame IDs, but `force=true` can
  leave dangling references. That scan does not model a project asset binding.
- Project, series, and personal library state is stored in separate JSON files.
  An in-process save lock protects some writes; it is not a durable transaction
  across those files or multiple server processes.
- The current index has `schema_version` but no monotonic content revision or
  delta cursor. Browser candidate pools and selected images can therefore
  temporarily reflect different read snapshots.
- Image asset generation tasks are held in backend process memory. The
  frontend persists `generatingTasks`, but the persisted entry contains only
  `assetId`, `generationType`, and `batchSize`, not the backend `task_id`.
  After a backend restart, the browser can keep showing an asset as generating
  while `/tasks/{task_id}` can no longer resolve it.
- Startup orphan recovery currently sweeps persisted storyboard video tasks;
  it does not recover in-memory image generation tasks. The asset UI removes
  its local generating marker only after polling reports completion or failure,
  so an unreachable task has no user cleanup action.

Evidence owners: `src/apps/comic_gen/models.py` (`ImageVariant`, `AssetUnit`,
`AssetReferenceIndex`), `pipeline.py` (`get_asset_reference_index`,
`create_asset_generation_task`, `_resolve_asset_library_reference`,
`delete_library_asset`), and the existing
`2026-09-22-asset-material-reference-contract-v1.md`.

The stale-generation observation is additionally owned by
`frontend/src/store/projectStore.ts` (`generatingTasks` persistence),
`frontend/src/components/modules/ConsistencyVault.tsx` (polling and marker
removal), and `pipeline.py` (`asset_generation_tasks` in-memory registry).

## Direct Implications

- A candidate visible in a picker is not automatically a project asset or a
  model input. Only an explicit generation reference in the submitted request
  is model input.
- A personal asset visible through global fallback is not evidence that the
  project deliberately adopted that asset. Direct project use needs its own
  persisted binding and removal semantics.
- Fast optimistic UI updates alone cannot provide cross-device or team
  consistency. A server commit revision must order writes and read projections.

## Terms and Identity

| Object | Identity | Meaning |
| --- | --- | --- |
| Workspace | `workspace_id` | Personal, project, or series collection and access boundary; future team workspaces are another owner type. |
| Material | `media_id` (target contract) | Immutable image/video/audio file with storage key, type, checksum, provenance, and lifecycle state. Current Studio URLs require migration. |
| Asset | `(asset_type, asset_id)` | Semantic character, scene, or prop, independent of file path or display name. A scene asset is a reusable location/setting; it is not a storyboard shot. |
| Asset variant | `(asset_type, asset_id, variant_id)` | One image/video representation attached to an asset and referring to material. Variant IDs are stable and never reused. |
| Placement | `placement_id` | An asset's membership in one workspace. It is not inferred from an identically named asset elsewhere. |
| Direct project binding | `binding_id` | Read-only project use of a source asset at an explicit source revision, with frozen display/variant metadata and retained media references. |
| Generation reference | `reference_id` within a draft/task | Ordered use of an authorized asset variant or material as a model input; it creates no project asset by itself. |
| Workspace revision | `(workspace_id, revision)` | Monotonic committed change position for one workspace. `schema_version` describes response shape and is not this revision. |
| Effective index cursor | Opaque server-issued cursor | Read position across every workspace currently visible in an index, plus the visibility/permission version. |
| Task manifest | `task_id` | Immutable accepted prompt, model, ordered inputs, and resolved material identities. |

Names, personas, URLs, thumbnails, signed links, and array positions are display
or delivery fields, never identity or authorization keys. A character age or
appearance variation can be a separate semantic asset linked by persona; its
image views remain variants within that asset.

## User Scenarios

| Action | Persisted effect | Project result |
| --- | --- | --- |
| Upload image/video to personal workbench | Register material in personal workspace | Available as material; no semantic asset or project membership yet. |
| Import material as character/scene/prop | Create semantic asset, initial variant, and personal placement | Becomes a reusable personal asset. |
| Use personal variant as generation reference | Add explicit draft binding; accepted task records exact input | Generated output belongs to its target asset with source provenance. Source remains unchanged. |
| Add personal asset directly to project | Create project binding with chosen source revision, metadata snapshot, and variant set | Read-only project asset, immediately usable by shots and generation selectors. No generation occurs. |
| Change a direct-bound asset | Explicit refresh binding to a newer source revision, or fork to a new project-owned asset | Existing projects never silently change because the personal source changed. |
| Remove project binding | Delete project membership after dependency check | Personal source and its material survive. |
| Add/delete one asset variant | Change variant membership and selected ID atomically | Main image, strip, and candidate index move to the same revision. |
| Delete personal asset/material | Check every binding, draft/task retention, and shot dependency | Refuse destructive deletion while required, or use an explicit detach/archive migration. |

Generation failure is not asset deletion. A failed attempt must leave the
existing asset and successful variants usable, while exposing the failed task
diagnostic and a retry or dismiss action. A user must never need to delete a
character just to clear a failed generation marker.

Image and video variants share identity and lifecycle rules. Their generation
roles differ: video may be a direct project asset, source clip, or output, while
reference support remains gated by the selected model's capability contract.
The bound snapshot pins media identity and display metadata; the source asset's
latest mutable fields are not substituted when the project reads the binding.
Editing a bound asset requires an explicit fork or refresh operation.

## Effective Index Spaces

1. **Personal catalog:** assets and loose materials owned by a profile. Future
   team catalogs require membership and role checks at query and mutation time.
2. **Project catalog:** project-owned assets and explicit direct bindings.
   Series placements may be inherited, but source scope and binding identity
   remain visible; a personal picker candidate is not implicitly promoted.
3. **Candidate index:** a permission-filtered projection of project, permitted
   series, personal, and later team sources. It answers what can be selected;
   it does not state what is in the prompt or submitted task.
4. **Draft input set:** locally selected candidates and explicit prompt/shot
   bindings. Removing a candidate removes or invalidates its binding, never
   redirects it to another variant with the same name.
5. **Task manifest:** frozen, server-validated inputs accepted for one job.
   Later edits/deletions affect subsequent submissions, not this job. Media
   retention must keep accepted inputs available until task completion and its
   required audit window; this differs from current execution-time re-resolution.

Index entries must expose source workspace, placement/binding ID where relevant,
asset and variant IDs, selected variant, availability state, and committed
revision. A semantic/vector search index may rank these entries for discovery,
but the structured index remains the authority for membership and access.

An effective project index can change when its project, inherited series,
personal catalog, or permitted team catalog changes. A project-only revision
is insufficient. Its opaque cursor represents the source revision vector and
access version; the server validates it and merges source deltas in precedence
order. Permission changes or an expired change-log position require a fresh
snapshot. The client must never infer this vector from displayed timestamps.

## Proposed Operation Shapes

```text
POST /projects/{id}/asset-bindings
  source_workspace_id, asset_type, source_asset_id,
  source_asset_revision, selected_variant_ids, mutation_id,
  expected_project_revision
  -> binding, project_revision, index_delta, index_cursor

POST /workspaces/{id}/assets/{type}/{asset_id}/variants
  media_id, metadata, mutation_id, expected_workspace_revision
  -> variant, asset_revision, workspace_revision, index_delta

DELETE /workspaces/{id}/assets/{type}/{asset_id}/variants/{variant_id}
  mutation_id, expected_workspace_revision
  -> tombstone, replacement_selected_variant_id, workspace_revision,
     reverse_dependency_conflicts (on HTTP 409)

GET /projects/{id}/asset-index?cursor={opaque_cursor}
  -> changes, tombstones, next_cursor; snapshot when cursor is invalid
```

These are target contracts, not existing endpoints. Mutation responses include
the complete changed object needed for immediate UI convergence; a full project
GET is not required to clear one task or asset mutation.

## Atomic Mutation Contract

Each write carries `workspace_id`, actor identity, `mutation_id` (idempotency
key), and `expected_revision`. The server checks current membership/role and
source visibility, then performs the following as one durable transaction:

1. Validate target and referenced identities and exact variant membership. A
   direct binding checks `source_asset_revision` under the same transaction.
2. Apply the asset, placement, binding, or variant change; maintain selected
   variant and reverse dependencies. Never silently choose a different source
   reference for an existing prompt or task.
3. Advance the affected workspace revision and append an ordered change event
   containing changed IDs or tombstones. A cross-workspace direct binding
   records both the source revision it pins and the project revision it creates.
4. Commit and return the changed object, new revision, and index delta. Replays
   of the same `mutation_id` return the original result; conflicting mutations
   return a revision conflict with the current projection.

Upload stages bytes first, then registers the material and variant in one
metadata transaction. Failed registration leaves only a collectible staged
file. Physical deletion runs after metadata commit and retention checks, never
inside the user-facing transaction. Delete creates a tombstone so an older GET,
poll, or delayed event cannot resurrect the object in a client cache.

The current JSON-file store cannot guarantee these cross-container atomic
operations for future multi-process/team writes. Implementation requires a
transactional metadata owner (or a proven single-writer journal with recovery),
plus transactional event/outbox publication. An in-memory lock or a full-project
GET after each mutation is not an equivalent guarantee.

## Exception and Recovery Contract

Every asynchronous image or video operation has a durable task record, even if
the worker queue is in memory. The task state machine is:

```text
accepted -> queued -> running -> succeeded
                         |-> failed_retryable
                         |-> failed_permanent
                         |-> cancelled
queued/running -> expired_orphaned
```

Each record contains `task_id`, owner/workspace, target asset identity, input
manifest, attempt number, created/updated/heartbeat timestamps, provider IDs,
safe error code, user-readable detail, and whether a result was committed. The
asset's `generation_status` is a projection of the latest attempt; it is not
the task record and cannot be the only cleanup state.

Required behavior:

- **Submit failure:** if validation or provider submission fails before work is
  accepted, atomically mark the task terminal and restore the asset's prior
  usable status. Return the error code and task ID; do not leave `processing`.
- **Worker failure:** persist terminal state and diagnostics. A retry creates a
  new attempt linked to the original manifest; it does not overwrite history or
  silently change references, model, or prompt.
- **Heartbeat timeout:** mark queued/running work `expired_orphaned` after a
  bounded lease. Retry only with provider idempotency or an explicit cost
  decision; otherwise expose “check provider / dismiss”.
- **Backend restart:** reconcile durable leases and provider IDs. An in-memory
  task with no durable record is abandoned, and its asset marker is cleared or
  marked recoverable during startup reconciliation.
- **User cleanup:** provide idempotent `dismiss/clear failed task`. It clears
  the UI projection and stale generating marker but preserves successful
  variants, diagnostics, and audit history. `cancel` is separate: it requests
  provider cancellation and may end as cancellation-unknown.
- **Partial success:** commit successful batch variants and mark the attempt
  `succeeded_with_warnings`; failed outputs remain diagnosable and do not block
  the asset.
- **Missing target or source:** mark `invalidated` with a typed reason such as
  `asset_deleted`, `variant_deleted`, `workspace_revoked`, or `source_missing`.
  Do not poll forever or retarget to a same-named asset.

The client stores backend `task_id` and workspace/index revision with each
optimistic marker. On reload it queries the task ledger; an unknown ID becomes
`expired_orphaned` and is dismissible. It must never persist an uncorrelated
`assetId -> generating=true` flag. Terminal events update only the target asset
and affected index entries, then remove the marker by task ID.

Every failed or stale task must expose **查看原因**, **重试** when retryable,
**取消** when running, and **清除状态** always. Clearing state does not delete
the asset or its successful variants.

## Client Synchronization

- Apply an optimistic local delta immediately to main preview, strip,
  candidate pool, and direct-binding list. Track it by `mutation_id`.
- On acknowledgement, replace it with the server delta and revision. On
  rejection, remove that optimistic delta and show the current authoritative
  state. Do not let an older response overwrite a newer revision.
- Fetch merged deltas with the last effective index cursor. On a missing cursor
  or source revision gap, reload the affected index. Full project GET is for initial
  load or recovery, not the normal completion path for one asset task.
- A task-completion event updates only its output asset and relevant index
  entries. Concurrent selection and deletion are serialized or rejected by
  `expected_revision`; a deleted variant cannot reappear via task polling.

## Team Boundary

Model ownership as `(tenant_id, workspace_id)` and access as membership plus
role. Personal assets remain personal until explicitly shared or bound into a
project. Team membership changes invalidate access to source catalogs; an
existing project binding needs a defined retained-use license or a detach
workflow. Search and CDN delivery must enforce the same authorization as the
structured index. Neither possession of an ID nor a previously signed URL
grants mutation or durable access.

## Expected Benefits

- Project membership and model input become inspectable, separate decisions.
- A deleted variant cannot return from a stale response, and two editors can
  detect conflicting writes instead of silently overwriting each other.
- One asset change can refresh only affected index entries and shots, reducing
  the delay and payload cost of whole-project reads.
- Personal and future team assets can be reused without silently copying or
  mutating the source; each project binding and generated output retains lineage.

## Not Yet Proven / Decisions Before Cutover

- Current production frequency and causes of stale candidate/index reads need
  request/revision telemetry. The recent UI fix proves only the local behavior.
- Decide whether project bindings retain access after the source owner's team
  membership is revoked. V1 should reject creation without access and preserve
  existing accepted task manifests; retained project use needs product policy.
- Set task media retention and purge policy before promising immutable accepted
  manifests. Current jobs re-resolve references at execution.
- Confirm migration for copied assets that retained child variant IDs, legacy
  character containers, and script re-extraction that replaces entity UUIDs.

## Implementation Slices and Verification

1. Inventory all writers and reference readers; introduce identity/lineage
   records and a transactional metadata owner without changing UI behavior.
2. Add explicit project bindings and reverse-reference checks. Verify direct
   use, unlink, source edits, and cross-owner denial with backend tests.
3. Add workspace revisions, idempotent mutations, deltas, and tombstones.
   Test concurrent select/delete, duplicate requests, delayed polls, restart,
   and multiple writers against persisted state.
4. Persist a unified task ledger and lease recovery. Add retry, cancel, clear,
   partial-success, orphan, provider-timeout, and missing-source tests. Remove
   browser-only generating flags that have no task ID.
5. Move image and video selectors to revisioned deltas and optimistic rollback;
   test main preview, strip, `@` candidates, and shot selectors together.
6. Freeze accepted task manifests and material retention; test deletion after
   submit, task retry, permissions, and provider input order.

Success means every accepted mutation has one authoritative revision, every
client can converge from that revision without a whole-project refresh, and
every submitted input is traceable to a permitted material and exact source
variant. No runtime behavior is claimed by this design document alone.
