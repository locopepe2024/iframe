# 3D 导演台浏览器草稿与响应式体验优化 V1

## Status

Implementation specification for the browser-only 3D Director workbench.

## Observed

- `restoreLocalDirectorDraft()` returns the saved timestamp and restores the
  authoring state, but `DirectorWorkbench` discards that return value.
- `App` therefore renders “尚未保存” after a reload even when a draft was
  explicitly restored.
- The desktop workbench keeps a three-column minimum of 236px + 520px + 286px
  through the tablet-width range. When the host shell leaves less room than
  that total, the stage and inspectors can overflow horizontally.

## Direct implication

- A restored local draft is technically available, but the visible save status
  does not reflect the restored local state.
- Tablet users can lose access to part of the authoring surface without an
  intentional compact layout.

## Not yet proven

- No browser-pixel measurement has been collected for every host-shell width;
  the responsive change is based on the CSS minimum track sum and the shell's
  persistent sidebar width.
- No durable project persistence is introduced by this change.

## Scope and boundaries

- Keep the local browser draft contract and storage key unchanged.
- Pass the restored timestamp into the workbench UI so the existing local-only
  status surface reports recovery.
- Add a stage-first compact layout for constrained widths; preserve the
  existing three-column desktop layout.
- Do not add network calls, backend persistence, generation behavior, or new
  3D scene capabilities.

## Success criteria

1. Reloading an explicitly saved draft reports that the draft was restored and
   shows the saved time.
2. A fresh workbench still reports “尚未保存”.
3. The workbench switches to a stage-first, vertically scrollable layout before
   the three-column minimum can overflow the host content area.
4. Existing tests, typecheck, build, and `git diff --check` pass.

## Affected paths

- `frontend/src/components/director3d/DirectorWorkbench.tsx`
- `frontend/src/components/director3d/App.tsx`
- `frontend/src/components/director3d/DirectorWorkbench.test.tsx`
- `frontend/src/components/director3d/styles.css`

## Verification

```bash
cd frontend
npm run test:all
npm run typecheck
npm run build

cd ..
git diff --check
```
