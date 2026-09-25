# 3D 导演台工作区便捷性切片优化 V1

## Status

Implementation specification for incremental workbench usability improvements.
Slices 1-3 are implemented with automated verification records; final browser
verification for slice 3 remains pending. Slice 4 remains a proposal and
requires its own shot-list/export contract before implementation.

## Evidence labels

### Observed

- At `1440 x 1000`, the center stage column has `872px` of visible height and
  about `5370px` of scrollable content.
- The camera composition panel starts around `3511px`, the camera path panel
  around `4476px`, and the camera noise panel around `4807px` in that column.
- While a composition checkbox is being edited, the stage toolbar and viewport
  can be more than `3700px` above the visible area.
- At `390 x 844`, the director content is about `12679px` tall. The stage and
  all temporal panels precede the scene tree and joint inspector.
- Runtime checks confirmed no horizontal overflow. The WebGL canvas, view
  switching, actor selection, pose presets, composition guides, camera path
  creation, timeline playback, local save/restore, undo, and redo work.
- Public official documentation for Blender and Unreal places camera preview,
  camera parameters, timeline playback, and keyframe operations in adjacent
  work surfaces. Shot Designer documents connected diagram, camera, animation,
  and shot-list workflows. Storyboarder emphasizes low-friction creation,
  duplication, reordering, keyboard commands, and export.

## Research references

Public product documentation reviewed on 2026-09-22:

- [Blender Timeline](https://docs.blender.org/manual/en/latest/editors/timeline.html)
  and [Camera View](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/camera_view.html):
  timeline navigation and camera framing remain directly available during scene work.
- [Unreal Engine Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematics-and-movie-making-in-unreal-engine)
  and [Cinematic Cameras](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-cameras-in-unreal-engine):
  shot timing, playback, camera selection, and camera parameters are adjacent
  authoring concerns.
- [Shot Designer](https://www.hollywoodcamerawork.com/shot-designer.html):
  blocking, cameras, animation, and shot-list work are connected in one planning flow.
- [Wonder Unit Storyboarder](https://wonderunit.com/storyboarder/):
  rapid creation, duplication, reordering, keyboard operation, and export reduce
  friction in shot planning.

These references support workflow comparison only. They do not prove that their
complete feature sets or layouts should be copied into iFrame.

### Direct implication

- The current capability set is usable in isolation, but camera authoring
  requires repeated long-distance scrolling and removes the visual result from
  view while parameters are edited.
- Camera composition, camera motion, and camera noise are one context and
  should share the camera-view inspector rather than extend the stage column.
- The workbench should be improved in reversible slices so existing local
  draft, store, timeline, and Three.js behavior remain independently verifiable.

### Not yet proven

- The external products are references for common workflow patterns, not proof
  that every feature belongs in iFrame.
- This specification does not establish a durable project format, collaboration
  model, shot-list schema, storyboard export, or Studio integration contract.
- Touch precision for direct Three.js gizmo manipulation still needs a separate
  device-level validation pass.

### Hypotheses

- Keeping the stage visible while camera controls scroll independently will
  materially reduce navigation cost for framing and motion authoring.
- A bottom timeline dock and a snapshot-backed shot list will provide the next
  largest workflow improvements after the camera inspector slice.

## Product boundary

- Preserve the browser-only director truth surface and local draft key.
- Do not add backend calls, generation submission, Studio store imports, or
  Atelier store imports.
- Do not change director document semantics in the layout slices.
- Preserve the green / white interaction palette and red-only error/destructive
  semantics.
- Preserve keyboard access, 44px label/button hit areas, responsive behavior,
  and the existing WebGL error boundary.

## Slice plan

### Slice 1: Camera context inspector

Move these existing tools out of the center stage scroll and into the right
inspector when `viewMode === "camera"`:

- camera composition and immutable snapshots;
- camera motion paths;
- deterministic camera noise.

Expose the tools through an accessible three-tab control:

```text
Camera view
  -> Stage remains visible in center
  -> Right inspector
       [构图] [运镜] [噪声]
```

The active tab is local presentation state. It is not added to the director
document or local draft.

Success criteria:

1. Entering camera view replaces the joint/object inspector with camera tools.
2. Composition, path, and noise tabs are keyboard reachable and expose only
   their active panel.
3. Camera controls are no longer rendered below the center stage.
4. Scrolling camera controls does not move the stage viewport.
5. Existing camera state mutations and local save behavior are unchanged.
6. Director UI tests, typecheck, build, and `git diff --check` pass.

### Slice 2: Timeline dock

- Keep playback, playhead, tracks, and keyframes in a collapsible bottom dock.
- Keep stage and current inspector visible while the timeline scrolls.
- Desktop (`>=1261px`): keep the three-column workbench; the center column is
  split into a scrollable stage workspace and a bottom dock with its own
  vertical scroll. The dock is capped so it cannot hide the stage completely.
- Compact desktop (`761-1260px`): retain the stage-first single-column flow;
  the dock is a full-width section after the stage and before secondary temporal
  panels, without a nested fixed-height scroll region.
- Mobile (`<=760px`): keep the same stage → camera tools → timeline → secondary
  temporal tools order when camera view is active. The dock becomes normal flow,
  keeps 44px control targets, and does not create horizontal or nested scrolling.

Slice 2 success criteria:

1. `TimelinePanel` is rendered exactly once inside a named `.timeline-dock`.
2. Minimizing the dock hides playback, playhead, track, and keyframe controls
   while keeping the dock header and expand action reachable.
3. On desktop, changing the dock's vertical scroll position does not change the
   stage canvas position or the right inspector scroll position.
4. On compact desktop and mobile, the dock participates in normal document flow
   and does not cover the stage or secondary temporal panels.
5. Existing playback, keyframe, track, local draft, and undo/redo state owners
   remain unchanged.

### Slice 3: Temporal tool grouping

- Group dialogue, narrative focus, contact anchors, actor paths, path events,
  and camera noise as contextual tabs or track inspectors.
- Do not duplicate owners or introduce fallback state.

Slice 3 implementation contract:

- Use one `时间工具` context container with tabs `对白 / 焦点 / 接触 /
  人物路径 / 路径事件`.
- Default to `对白`; the selected tab is local presentation state and is not
  persisted into the director document or browser draft.
- Use the same roving-tabindex keyboard contract as the camera inspector:
  Arrow Left/Right, Home, and End move focus and activate the corresponding
  panel.
- Keep inactive forms mounted but hidden so switching context does not discard
  an in-progress, unsubmitted form. Only the active panel is exposed to the
  accessibility tree.
- Camera noise remains owned by `CameraToolsInspector`; it must not be
  duplicated in the temporal container.

Slice 3 success criteria:

1. The five temporal tools render inside one `.temporal-tools` context region.
2. Exactly one temporal panel is visually active and exposed as a tabpanel.
3. Keyboard tab navigation and click navigation select the same panel.
4. Switching tabs preserves each panel's local draft inputs until submit or
   cancel, while all existing store mutations and undo behavior remain intact.
5. The grouped surface has no horizontal overflow at `390px`; its active panel
   follows the existing 44px control-target contract.

### Slice 4: Shot list foundation

- Promote immutable camera snapshots into ordered shot cards.
- Define duplicate, reorder, rename, preview, and delete behavior.
- Write the shot-list and export schema before adding any export command.

## Slice 3 affected paths

- `frontend/src/components/director3d/App.tsx`
- `frontend/src/components/director3d/TemporalToolsInspector.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`

## Slice 3 verification record

- The existing temporal panels are rendered once each inside one
  `.temporal-tools` context region; camera noise remains owned by the camera
  inspector.
- The default `对白` tab exposes only the dialogue panel. Switching to
  `焦点`, `接触`, `人物路径`, or `路径事件` keeps inactive forms mounted but
  hidden, preserving an in-progress dialogue draft when the user returns.
- Click navigation and Arrow Left/Right, Home, and End keyboard navigation use
  the same roving-tabindex behavior as the camera inspector.
- UI tests: 10/10 director workbench tests passed; full UI suite: 207/207
  tests passed. TypeScript typecheck passed.
- The “写入导出标记” checkbox test now enters `路径事件` explicitly because
  the contextual panel defaults to `对白`; this validates the intended
  progressive-disclosure behavior instead of assuming every temporal control
  is simultaneously visible.
- Browser verification is recorded below after explicit permission to use
  Playwright against the local `/director` route at desktop and mobile widths.

### Slice 3 browser verification record (2026-09-23)

- At `1440 x 1000`, the center canvas remained visible while the camera
  inspector was scrolled independently; the director root had equal client and
  scroll widths (`1232px`), and the timeline collapse/expand actions reduced
  the dock to `58px` and restored its controls without console errors.
- The browser click path exposed a pointer-interaction bug: the sticky stage
  layer intercepted clicks on temporal tabs after the browser scrolled them
  into view. The stage column now stays in normal flow within the center scroll
  region, so temporal tabs can be reached by real pointer clicks. The fix does
  not alter the separate right-side camera inspector or bottom timeline dock.
- At `1260 x 900`, the workbench used the stage-first natural-flow layout with
  order `stage → camera tools → timeline → temporal tools → scene tree` and no
  horizontal overflow (`1078px` client and scroll widths).
- At `390 x 844`, the same order held, the root client and scroll widths were
  both `390px`, and the temporal tab strip stayed within its `364px` content
  width. The checkbox visuals measured `18px`; their labels retained at least
  `44px` height (the wrapped mobile export-marker label measured `63px`).
- Real pointer clicks switched camera and temporal tabs, the camera and
  temporal roving-tabindex keyboard paths selected the expected next tab, and
  an unsubmitted dialogue draft survived switching to `焦点` and back.
- Playwright reported zero console errors and zero warnings across the three
  viewport checks.

## Slice 1 affected paths

- `frontend/src/components/director3d/App.tsx`
- `frontend/src/components/director3d/camera/CameraToolsInspector.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`

## Verification

```bash
cd frontend
npm run test:ui -- --run src/components/director3d/DirectorWorkbench.test.tsx
npm run typecheck
npm run build

cd ..
git diff --check
```

Browser verification is required at desktop and `390px` mobile widths. The
approved scope is the local `http://127.0.0.1:3008/#/director` route only.

## Slice 1 verification record

- Director UI tests: 8/8 passed.
- TypeScript typecheck and production build passed.
- At `1440 x 1000`, scrolling the camera inspector from `0` to `312px` kept the
  stage canvas at the same viewport position.
- At `390 x 844`, root `clientWidth` and `scrollWidth` both measured `390px`.
- Mobile order is stage, camera tools, temporal tools, then scene tree.
- Camera tool tabs support click plus Arrow Left/Right, Home, and End navigation.
- Mobile timeline controls use at least a `44px` hit area; compact checkboxes
  remain `18px` inside a `44px` label target.
- The current-page browser console reported no errors and the WebGL canvas
  produced nonblank pixels.

## Slice 2 verification record

- `TimelinePanel` now has one owner and is rendered inside `.timeline-dock`.
- At `1440 x 1000`, the center workspace measured `872px` high with a `290px`
  bottom dock; the stage canvas remained at `top: 173px` while the timeline
  panel scrolled independently.
- Collapsing the dock reduced it to `58px` and removed playback, playhead, track,
  and keyframe controls from the DOM while leaving the expand action reachable.
- At `1260 x 900`, the layout became stage-first natural flow with no horizontal
  overflow. At `390 x 844`, the order was stage, camera tools, timeline, other
  temporal tools, then scene tree, with no horizontal overflow.
- UI tests: 9/9 passed; typecheck, production build, and `git diff --check`
  passed after the Slice 2 changes.
