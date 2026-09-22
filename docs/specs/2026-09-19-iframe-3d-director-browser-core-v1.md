# iFrame 3D Director Browser Core V1

## Status

Implementation specification for `feature/iframe-3d-director-v1`.

## Evidence and assumptions

- **Code fact:** the source workbench at `demo/director-reference/frontend` contains a browser Three.js stage, two editable humanoids, pose controls, cameras, actor paths, and timeline controls.
- **Code fact:** its explicit project save, media catalog, subject proxy, and render flows call a standalone `/api/*` service that is not part of iFrame Core.
- **Direct implication:** importing those service calls would create a second project, asset, and task truth surface inside iFrame.
- **Assumption:** local browser draft persistence is sufficient for the first reviewable slice. Durable iFrame project persistence needs a separate contract mapping owner, project, asset, and task identifiers.

## Goal

Add a branded, lazy-loaded `#/director` workspace to iFrame that works without UniArt and lets a user block a scene with browser-native controls:

- inspect and select two humanoid actors;
- edit pose, position, rotation, and scale;
- switch director, top, and camera views;
- edit cameras, actor paths, composition, focus, dialogue, and the bounded timeline;
- undo and redo authoring operations;
- save and restore a local browser draft.

## Boundaries

V1 does not:

- call UniArt or any generation model;
- submit Blender or server render jobs;
- call the standalone director `/api/projects`, `/api/inputs`, `/api/assets`, `/api/model-assets`, or subject proxy APIs;
- claim that local drafts are iFrame projects or reusable assets;
- bind director state to Studio, Recreation, or Atelier state stores.

The imported store remains feature-local under `components/director3d`. Future durable persistence must map the director document into iFrame Core contracts before any server write is enabled.

## UI integration

- Add `director3d` to the shared navigation model with hash `#/director`.
- Lazy-load the workbench so Three.js and its model do not enter the normal workspace startup path.
- Keep all imported CSS below `.director3d-root`.
- Preserve keyboard undo/redo and view-tab navigation.
- Provide a compact mobile state with a stage-first layout and horizontally scrollable inspectors; desktop retains the three-column authoring layout.
- If WebGL initialization fails, show an error boundary inside the director route rather than crashing the iFrame shell.

## Local draft contract

- Storage key: `iframe.director3d.browser-draft.v1`.
- Save is explicit and writes only the serializable authoring state required to restore the browser workbench.
- The UI labels it as a local browser draft.
- Draft read/write failure is surfaced locally and does not trigger a network fallback.

## Success criteria

1. `#/director` opens from desktop and mobile navigation.
2. The model renders and the director/top/camera view controls work.
3. Pose changes and undo/redo work.
4. Reload restores the last explicitly saved local draft.
5. Opening and using the V1 workspace sends no standalone director API requests.
6. Existing iFrame tests, typecheck, and production build pass.
7. CSS remains scoped and existing iFrame routes retain their layout.

## Verification

```bash
cd frontend
npm run test:all
npm run typecheck
npm run build

cd ..
python3 scripts/check_workflow_parity.py
git diff --check
```

Visual and canvas-pixel verification is required before release. Browser automation is approval-gated by the workspace instructions and will be run only after the user authorizes the local `http://127.0.0.1:3008/#/director` scope.
