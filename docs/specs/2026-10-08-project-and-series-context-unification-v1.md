# Project and series context unification v1

## Decision

Series projects and standalone projects use the same production stages and the same implementation for Director/Style, Assets, Storyboard, Shot Design, and Assembly.

The difference is context scope:

- standalone project: one project and one script context;
- series project: series context plus the selected episode context, including shared assets and continuity.

`workflow_mode` is a migration/context capability flag, not a second storyboard or shot-list implementation. `r2v` is the current context-aware workflow; `i2v_legacy` is retained for older projects that do not have Cast and series context capabilities.

## Current stages

Scripted standalone: Script -> Director -> Assets -> Storyboard -> Shot Design -> Assembly.

Scripted series: Script -> Director -> Cast -> Assets -> Storyboard -> Shot Design -> Assembly.

Freeform series omits Script because the series begins from creative planning rather than an episode script. This changes navigation context only; the downstream production components remain shared.

The old "5 step / 9 step" description is retired. The current code exposes six stages for standalone legacy projects and seven for current series projects, with the same Storyboard, Shot Design, and Assembly components.

## Non-goals

- Do not merge `StoryboardComposer` and `StoryboardR2V` in this change. They have separate responsibilities: scene/reference preparation and shot/video design.
- Do not duplicate generation or assembly code for series and standalone projects.
