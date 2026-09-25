# iFrame 3D 导演台集成入口 V1

## Status

Selected integration boundary for the iFrame test platform.

## Observed

- iFrame uses `frontend/src/app/page.tsx` as a client-side hash router and
  already lazy-loads heavy destinations with `next/dynamic` and `ssr: false`.
- `AppShell` owns the shared desktop sidebar and mobile bottom navigation;
  `GlobalSidebar.GLOBAL_NAV_ITEMS` is the shared navigation model.
- Three.js, React Three Fiber, Drei, Zustand, and the existing static model
  directory are already present in iFrame.
- The browser 3D director core is deliberately local-only: it owns its own
  authoring store and local draft key and does not call Studio, Atelier, or
  generation APIs.
- The host page still mounts account-scoped environment checks and workspace
  project synchronization globally. Those side effects must be route-aware so
  the local-only director is not blocked or made noisy when the backend is
  unavailable.
- The current iFrame worktree contains unrelated uncommitted Recreation
  changes. The director integration must not overwrite those files or their
  hunks.

## Direct implication

- The lowest-risk integration is a top-level hash route, not a project-detail
  child route. It preserves the director's separate truth surface while still
  making it reachable from the shared product shell.
- The existing dynamic-import boundary is the correct performance boundary for
  the 3D bundle and GLB asset.
- The global stylesheet import is acceptable only because the director CSS is
  namespace-scoped below `.director3d-root`.
- `EnvConfigChecker` and the initial workspace sync are explicitly bypassed on
  `#/director`; they resume their existing behavior for non-director routes.
- Static-export branding assets use relative URLs, matching the GLB asset
  contract so `/static/#/director` does not escape the configured base path.

## Not yet proven

- This slice does not prove durable project persistence or a Studio/Core data
  mapping.

## Chosen entry

```text
#/director
  -> page.tsx currentView === "director3d"
  -> dynamic DirectorWorkbench (ssr:false)
  -> local director3d store + local browser draft
```

The route is exposed in the desktop sidebar and mobile navigation. The mobile
bar keeps four primary destinations and moves secondary destinations under
“更多”, preserving the existing five-slot navigation contract.

## Boundaries

- Do not import Studio or Atelier stores into `components/director3d`.
- Do not bind a director document to a Studio project ID in this browser-only
  slice.
- Do not add backend routes, generation submission, Blender rendering, or
  network fallbacks.
- Do not replace or reset unrelated dirty worktree changes.

## Success criteria

1. `#/director` is reachable from desktop and mobile navigation.
2. The director bundle is lazy-loaded and does not render during other routes.
3. The GLB model is served from the iFrame static asset tree.
4. Opening `#/director` without the backend does not open the UniArt config
   gate, trigger workspace sync requests, or produce console/request failures.
5. Desktop and 390px mobile layouts have no horizontal overflow; WebGL creates
   a canvas; view switching, character selection, and local draft saving work.
6. Existing app routes and the unrelated Recreation changes remain intact.
7. Existing tests, typecheck, production build, and diff checks pass.

## Affected paths

- `frontend/src/app/page.tsx`
- `frontend/src/app/layout.tsx`
- `frontend/src/components/EnvConfigChecker.tsx`
- `frontend/src/components/EnvConfigChecker.test.tsx`
- `frontend/src/components/layout/GlobalSidebar.tsx`
- `frontend/src/components/layout/BottomTabBar.tsx`
- `frontend/src/components/layout/IFrameBranding.tsx`
- `frontend/src/components/settings/UpdateChecker.test.tsx`
- `frontend/src/components/layout/BottomTabBar.test.tsx`
- `frontend/messages/en.json`
- `frontend/messages/zh.json`
- `frontend/src/components/director3d/**`
- `frontend/public/models/director3d/**`

## Verification

```bash
cd frontend
npm run test:all
npm run typecheck
npm run build

cd ..
git diff --check
```

## Browser verification (2026-09-21)

The local page was opened at `http://127.0.0.1:3008/#/director` with an
isolated headless Chrome context after explicit user approval for local browser
automation.

- 1440px: HTTP 200, one WebGL canvas (`590 x 418`), no config dialog, no API
  requests, no failed requests, no console errors, no fallback screen.
- 390px: no horizontal overflow (`scrollWidth === 390`), WebGL canvas present,
  camera tab selection changed, character B selection changed stage status, and
  `iframe.director3d.browser-draft.v1` was written to localStorage.
- Production static mount: `http://127.0.0.1:3010/static/#/director` returned
  HTTP 200; logo and GLB both returned 200 under `/static/`, WebGL initialized,
  and the page had no 4xx responses or console errors.
