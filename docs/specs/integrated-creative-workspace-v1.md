# LumenX Integrated Creative Workspace v1

## Status

Draft specification for review before implementation.

## Observed

- LumenX Studio currently exposes separate hash views for the workspace, Canvas, asset library, settings, Playground, and Script Editor.
- `CreativeCanvas`, `AssetLibraryPage`, `SettingsPage`, and `ScriptEditorShell` are separate frontend modules mounted from `frontend/src/app/page.tsx`.
- The backend already exposes project, series, asset, storyboard, video-task, configuration, library, and playground APIs.
- Studio and Atelier have an explicit product boundary; this proposal applies to Studio only.

## Direct implication

The first integration slice can be implemented as a shared Studio shell and project context without changing provider routing, task ownership, or the Atelier domain. Existing modules can be mounted as workspace modes while their API clients and stores remain authoritative.

## Not yet proven

- Whether every image/video workbench has a stable reusable component boundary suitable for embedding in the Canvas shell.
- Whether current asset records contain all metadata needed for bidirectional selection and preview across script, canvas, and workbenches.
- Whether script editor autosave and Canvas persistence can share one save transaction without introducing conflicting ownership.

## Product objective

Provide one project-centered creative workspace where a user can move between:

1. Script / story analysis
2. Storyboard and shot planning
3. Image workbench
4. Video workbench
5. Canvas composition
6. Asset library
7. Project and model settings

The user should keep the current project, selected episode, selected shot, and selected asset while switching modes.

## Proposed information architecture

- **Left rail:** project/series switcher and workspace modes: Script, Storyboard, Canvas, Images, Video, Assets, Settings.
- **Center stage:** the active mode. Existing module pages remain the first implementation targets.
- **Right inspector:** context-sensitive details for the selected script block, shot, asset, or generation task.
- **Bottom activity strip:** recent generations, uploads, task status, and save state.
- **Global command surface:** create/import, search assets, open recent item, and switch project.

## Shared context contract

Create a neutral Studio workspace context, separate from Atelier state:

```ts
type StudioWorkspaceContext = {
  projectId?: string;
  seriesId?: string;
  episodeId?: string;
  selectedAssetId?: string;
  selectedShotId?: string;
  selectedScriptBlockId?: string;
  activeMode: "script" | "storyboard" | "canvas" | "image" | "video" | "assets" | "settings";
  dirtyScopes: Array<"script" | "canvas" | "assets" | "settings">;
};
```

Selection events should use IDs and source metadata, not copied record objects. Each module reloads authoritative data through the existing API client or store.

## Ownership boundaries

- `projectStore` remains authoritative for Studio project/series data.
- `settingsStore` remains authoritative for local UI preferences and model settings until a backend project-settings contract is introduced.
- Asset library remains the authoritative source for reusable personal assets.
- Canvas state remains authoritative for graph geometry, node relationships, and canvas snapshots.
- Script editor remains authoritative for script document content and snapshots.
- Async task state remains backend-owned; the activity strip displays status and does not infer completion from polling alone.
- Provider keys, supplier accounts, route groups, and billing controls remain outside this workspace.

## Cross-module flows

### Script to storyboard

A script block can create or focus a shot. The event carries `projectId`, `episodeId`, and `scriptBlockId`; storyboard data is fetched from the backend.

### Storyboard to image/video workbench

A shot can open the image or video workbench with `selectedShotId`. Prompt, reference assets, and model settings are loaded from the shot/project APIs.

### Workbench to asset library

Every generated or uploaded reusable result exposes `Save to Assets`. The backend persists ownership, source kind, mime/type, and retrieval path before the result is available to other modules.

### Asset library to canvas/script

Selecting `Use in Canvas`, `Attach to Shot`, or `Insert Reference` sends an asset ID and target scope. Modules resolve the asset through the asset API.

### Canvas to workbench

A canvas node can open the corresponding workbench with its node/asset/task IDs. Result writeback updates the target node through an idempotent backend operation.

## First implementation slice

1. Add `StudioWorkspaceShell` and `StudioWorkspaceContext`.
2. Move current hash view switching behind the shell while preserving existing URLs.
3. Add a shared project/episode context header and mode rail.
4. Add selection event types and adapters for Asset Library, Script Editor, and Canvas.
5. Embed existing pages as modes without changing generation behavior.
6. Add a minimal right inspector that displays selected IDs and basic metadata.
7. Add smoke tests for mode switching, context persistence, and deep links.

## Deferred slices

- Replacing separate pages with true split-pane workbenches.
- Shared undo/redo across script and canvas.
- Unified transactional save across script, canvas, and assets.
- Cross-mode drag and drop.
- Provider routing or model catalog changes.
- Atelier integration.

## Success criteria

- Switching modes preserves project, episode, and selected item.
- Existing deep links continue to open the same content.
- A selected asset can be opened from Assets and attached to a shot or canvas node by ID.
- A selected shot can open image/video workbench with its context loaded.
- No provider credentials or routing internals appear in the Studio workspace.
- Existing targeted frontend tests, typecheck, and production build pass.

## Verification plan

- Unit tests for context reducer/store and selection event adapters.
- Component tests for mode switching and deep-link hydration.
- API smoke tests for project, series, asset, and task endpoints.
- Manual checklist covering Script → Storyboard → Image → Assets → Canvas → Video.

## Rollback

Keep the existing hash routes and module components available behind the shell. The integration can be reverted by restoring the current route switcher and removing the shell mount; no backend schema migration is required for slice one.
