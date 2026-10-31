# Independent Editing Project Lifecycle and Material Reference Contract v1

## Observed

- Independent editing projects are stored as owner-scoped JSON records in `editing.sqlite3`.
- Saved plans already persist a per-project `sources` map containing material identity and SHA-256 snapshots.
- Source media remains in the immutable owner media registry; deleting an editing-library entry does not remove the blob.
- Project outputs are registered as generated editing media.

## Contract

1. Creating an editing project creates a logical project workspace under the owner editing namespace:
   `users/{owner_profile_id}/editing/projects/{project_id}/`.
   The workspace contains `tmp/` and `outputs/` directories. Existing projects receive the workspace lazily when read or rendered.
2. A project references source media by stable `media_id` namespace key. It does not copy source blobs into the project workspace.
3. Every saved revision stores source snapshots (`sha256`, display name, storage reference and media metadata). Save, restore and render re-resolve the source and reject missing, deleted, or checksum-changed material.
4. Project deletion is a soft delete. Deleted projects are hidden from active lists and all project operations return 404. Source media and other projects are unaffected. The workspace is retained for recovery/retention cleanup and is not synchronously purged.
5. Generated outputs are project-owned derivatives and are written below the project workspace before registration in the shared media registry.
6. Project IDs and material IDs remain owner-scoped; no cross-owner access is allowed.

## Success criteria

- `DELETE /editing/projects/{id}` returns a deleted record and makes the project unavailable to active list/get/save/render/version/restore routes.
- A newly created project has a workspace path and `tmp`/`outputs` directories.
- Rendering writes its output below that workspace.
- Deleting a project does not delete or mutate referenced source media.
- Historical projects without new fields remain readable and receive a workspace on access.

## Boundaries

- No permanent deletion or garbage collection in this slice.
- No source-media duplication.
- No change to episode/series project ownership.
