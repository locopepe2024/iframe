# Unified Shot Design workbench v1

## Observed

- `StoryboardR2V` already owns shot generation, T2I/I2V/R2V mode selection, reference variants, prompt editing, polish, candidates, and task history.
- `StoryboardComposer` is a second frame editor with overlapping storyboard generation and prompt editing behavior.
- Legacy `VideoCreator` is a separate unused-by-`ProjectClient` motion surface; it remains available for old standalone callers.

## Decision

The current cut does not merge the Storyboard scene-reference step with Shot Design. `StoryboardComposer` remains responsible for storyboard scene/reference preparation, while `StoryboardR2V` remains responsible for shot prompt and video design.

The product-level concept is that both operate on the same shots, but their responsibilities and project navigation entries remain separate until a dedicated migration defines which scene-reference decisions should move into each shot. This cut only shares the optimizer selector UI between `ShotCard` and the legacy `VideoCreator` surface.

## Success criteria

- Storyboard scene/reference preparation remains a distinct step.
- Shot Design remains the shot prompt and video generation step.
- Optimizer selection uses one shared component wherever AI polish is available.
- Existing frame ids, prompts, variants, and video task history remain unchanged.

## Verification

- `cd frontend && npm run typecheck`
- `cd frontend && npm run test -- --run src/__tests__/interactive-polish.test.ts`
