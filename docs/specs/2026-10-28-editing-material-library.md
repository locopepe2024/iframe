# Independent editing material library

## Observed

The editing UI currently renders a full material library inside the timeline page. The API exposes only a flat material list and upload endpoint; there is no owner-scoped directory or deletion contract.

## Direct implication

Uploaded media becomes difficult to manage as the library grows, and the timeline workspace loses vertical space. Directory and deletion state must be owned by the editing service rather than inferred in the browser.

## Scope

- Add owner-scoped editing folders.
- Add folder creation, rename, and deletion (deletion requires an empty folder).
- Allow uploads to target a folder.
- Return folder metadata and support folder filtering.
- Allow deletion of owner-owned editing uploads only when no saved edit references them.
- Keep generated/recreation materials read-only; they remain selectable but are not deletable from this manager.
- Split the standalone editing page into `剪辑` and `素材管理` tabs. The timeline tab keeps only a compact material picker.

## Success criteria

- A user can create a folder, upload multiple files into it, filter by folder, and delete an unreferenced upload.
- Attempting to delete a referenced upload returns HTTP 409 and leaves the file and registry record intact.
- Folder operations cannot cross owner boundaries.
- Existing project save/render/version behavior remains unchanged.
- Frontend tests cover folder creation, upload folder selection, deletion conflict, and tab separation.

## Boundaries

- No migration of existing media is required; existing uploads appear in “未分类”.
- No physical directory is created per folder. Folder metadata is stored in the owner-scoped editing database; media storage remains immutable and registry-backed.
