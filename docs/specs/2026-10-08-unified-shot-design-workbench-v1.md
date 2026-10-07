# Unified Shot Design workbench v1

## Observed

- `StoryboardR2V` already owns shot generation, T2I/I2V/R2V mode selection, reference variants, prompt editing, polish, candidates, and task history.
- `StoryboardComposer` is a second frame editor with overlapping storyboard generation and prompt editing behavior.
- Legacy `VideoCreator` is a separate unused-by-`ProjectClient` motion surface; it remains available for old standalone callers.

## Decision

For project and series workflows, Storyboard and Shot List are one product step named **Storyboard / Shot Design** and rendered by `StoryboardR2V`.

Scene/reference preparation remains a capability inside that workbench and does not create a second shot editor. The old `StoryboardComposer` navigation entry is removed from the project pipeline; its frame data remains compatible because both paths use the same `Script.frames` records.

`VideoCreator` is retained as a compatibility surface for callers outside `ProjectClient` until its generation controls are migrated into `ShotCard`.

## Success criteria

- Unified and legacy project modes expose one shot design step.
- Selecting the step mounts `StoryboardR2V` for both modes.
- Existing frame ids, prompts, variants, and video task history remain unchanged.
- No second storyboard/shot-list navigation item remains.

## Verification

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test -- --run src/__tests__/interactive-polish.test.ts`
