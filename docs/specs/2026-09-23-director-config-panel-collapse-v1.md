# 3D 导演台配置面板临时折叠 V1

## Status

Design and implementation specification for a reversible, browser-local
configuration focus mode. This slice is intentionally presentation-only and
does not change the director draft schema or persisted scene state.

## Evidence labels

### Observed

- The director workbench exposes several independent authoring surfaces at the
  same time: scene objects and joints on the left, stage and temporal tools in
  the center, a timeline dock, and camera/object/joint controls on the right.
- The timeline already supports a local minimize/expand action, but the left
  and right configuration columns remain full-height while the user edits a
  focused surface.
- On compact desktop and mobile, the same surfaces participate in one natural
  document flow, so a desktop-only width collapse would create a separate
  interaction contract.

### Direct implication

- Each major configuration surface needs an explicit, reversible collapse
  affordance so users can reduce visual competition while preserving the
  current selection and in-progress form values.
- A collapsed desktop side panel should leave an expand rail rather than
  disappearing completely; otherwise the control is difficult to rediscover.
- Mobile and compact desktop should hide panel bodies in normal flow instead
  of creating a fixed overlay or horizontal overflow.

### Not yet proven

- The optimal default collapsed state for a new director session is not known;
  this slice keeps all configuration surfaces expanded by default.
- A persistent user preference or project-level layout preset is out of scope
  until repeated runtime use demonstrates that persistence is valuable.

### Hypotheses

- Temporary collapse of non-active configuration surfaces will reduce visual
  scanning cost and make the stage or active inspector easier to focus on.
- Keeping collapse state local to the mounted workbench will avoid accidental
  changes to the director document while still making repeated edits within a
  session faster.

## Interaction contract

1. Add a native button to each major configuration surface:
   - left scene panel;
   - right inspector column;
   - center temporal-tools panel.
2. The existing timeline minimize/expand action remains the timeline contract;
   it uses the same 44px target and aria-expanded semantics.
3. Every collapse control exposes `aria-expanded` and `aria-controls`, has a
   visible focus ring, and uses a descriptive Chinese accessible name (`收起…`
   or `展开…`).
4. Collapse hides the body with `hidden` but does not unmount it. Local form
   drafts, active tabs, selections, and unsaved browser state remain intact.
5. Desktop (`>=1261px`) collapsed side panels become a compact expand rail and
   release their column space to the center workbench. The rail retains one
   44px expand target.
6. Compact desktop (`761-1260px`) and mobile (`<=760px`) keep normal flow:
   collapsing a panel removes its body from layout while leaving the header
   control reachable; no horizontal scrolling or fixed overlay is introduced.
7. Collapse state is local React presentation state. It is not written to the
   director document, local draft, URL, or backend.

## Boundaries

- No backend calls, export changes, store schema changes, or new persistence.
- Preserve the green / white interaction palette; red remains for errors and
  destructive actions only.
- Preserve existing panel owners, camera/temporal tab behavior, timeline state,
  WebGL error boundary, and 44px touch-target rules.
- Do not add a global "focus mode" that silently changes unrelated panels;
  each surface must be independently reversible.

## Success criteria

1. Left scene and right inspector columns can each be collapsed and expanded
   with pointer and keyboard activation.
2. Temporal tools can be collapsed without losing an unsubmitted dialogue or
   path-event draft; re-expanding exposes the same active tab and values.
3. Desktop collapse reclaims side-column space without changing the stage
   owner or causing horizontal overflow.
4. Compact desktop and mobile collapse uses normal flow and preserves the
   stage → camera tools → timeline → temporal tools ordering.
5. Automated tests cover `aria-expanded`/`aria-controls`, focusable expand
   rails, draft preservation, and the existing timeline collapse contract.
6. Typecheck, UI tests, build, and `git diff --check` pass.

## Affected paths

- `frontend/src/components/director3d/App.tsx`
- `frontend/src/components/director3d/TemporalToolsInspector.tsx`
- `frontend/src/components/director3d/timeline/TimelinePanel.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`
- `docs/specs/2026-09-23-director-config-panel-collapse-v1.md`

## Implementation and verification record (2026-09-23)

- Added local collapse controls for the scene configuration column, the active
  property inspector column, and the temporal-tools context panel. The
  timeline keeps its existing minimize/expand action and now exposes matching
  `aria-expanded`/`aria-controls` metadata.
- Desktop collapse turns either side column into a `56px` expand rail and
  reclaims the column for the center workbench. At `1440 x 1000`, collapsing
  both side columns changed the workbench columns to `56px 1120px 56px`.
- At `1260 x 900` and `390 x 844`, collapsed panels stayed in normal flow;
  the root client and scroll widths remained equal (`1078px` and `390px`
  respectively). The camera-first order remained
  `stage → camera tools → timeline → temporal tools → scene configuration`.
- Real browser clicks collapsed and expanded all three new surfaces. An
  unsubmitted dialogue value survived temporal-tools collapse and expansion.
  Each collapse control retained a `44px` target and descriptive accessible
  name.
- Playwright reported zero console errors during the desktop, compact, and
  mobile checks. Director UI tests: 11/11 passed; typecheck passed.
