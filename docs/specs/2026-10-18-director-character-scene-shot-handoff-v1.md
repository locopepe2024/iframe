# 导演理解、角色设计与分镜交接 V1

Date: 2026-10-18. Status: implementation plan. Builds on the character-design work in PR #191; this document does not claim all stages are implemented.

## Observed

- Confirmed episode Director profiles and shooting plans already have separate revisions. A confirmed plan projects `EpisodeVisualContext`; a frame can retain its own `director_shot_context`.
- Character design has a draft and confirmed revisions. Its structured identity/look fields can be reviewed and explicitly applied to image prompts; a design reference is not automatically an image-generation reference.
- Scene assets hold `asset_design` revisions with space, style, ambient lighting, camera/viewpoint and visual constraints. Before this slice, storyboard render preview read the scene's name/description and planned shot context, but `storyboard_frame_prompt_projection` did not read the scene's confirmed `asset_design` revision.
- Before this slice, the character workbench let a shooting-plan row append its scene place/time text directly into a character image prompt. Those rows describe where a character appears; they are not stable identity or costume facts.
- Storyboard render has a preview token bound to source context. When submitted as a complete prompt, the image adapter receives the reviewed text; changing source context invalidates the token.

## Ownership and production order

| Layer | Owner | Defines | Downstream use |
| --- | --- | --- | --- |
| Source and Director interpretation | Confirmed series/episode Director revision | Plot facts, actual place/time, scene order, story intent and unresolved facts | Shooting-plan proposal and initial scene/shot candidates; metaphors are not image parameters |
| Initial storyboard | Confirmed plan plus editable frame | Which action needs coverage, initial shot size, camera, composition, transitions and subject state | Demand signal for scene/character/prop references |
| Character design | Confirmed character design revision | Stable face, hair, skin, body, clothing and identity marks | All role tasks and shots using that character; task views do not create a second identity owner |
| Scene design | Confirmed scene asset design revision | Fixed spatial landmarks/materials, scene activity, environment light and baseline viewpoint | Scene master/coverage and relevant shot previews |
| Current shot | Frame revision and explicit selected variants | Local camera, composition, action, practical light/occlusion, first/last frame and media mode | Exact image/video generation review |

Order is iterative: Director interpretation → initial storyboard → character/scene/prop design ↔ refined storyboard. A location master (e.g. one room) may support multiple story scenes and camera angles. A story scene's current events do not permanently rewrite the location master.

## Projection rules

1. For a frame, resolve the exact project/series scene and character assets by ID. Read only their latest **confirmed** design revisions. A draft is visible only in its own editor and never silently projected.
2. Scene design light and camera are the visual baseline. Plan language remains source intent; if it conflicts with a newer confirmed scene baseline, surface the difference for review instead of concatenating both as equally binding commands. The frame's explicit local override wins within its scope.
3. Role identity stays stable across full-body, turnaround and shot tasks. Current wardrobe state may be shot-local only when confirmed as a separate look/state change.
   Shooting-plan scene rows remain visible for inspection in the character workbench, without a direct "add to character prompt" action.
4. Before an LLM refinement call, pass the bounded, source-tagged relevant snapshot. The model returns a complete candidate, not a base prompt plus hidden appended constraints. The creator applies the candidate to visible text.
5. Before image/video generation, show the final prompt, mode, references, scene/character/plan revisions and any conflicting or stale source. Never bind a reference image because a task template or asset name merely mentions one.
6. A reviewed submission is immutable input: the preview fingerprint includes the chosen asset design revisions and frame fields. Upstream edits require a new preview; they do not mutate existing output variants.
7. A polished image prompt is a snapshot of the confirmed design revisions available when the LLM call started. Store those source IDs/revisions with the candidate. If a confirmed scene or character design changes, the next render preview must flag the accepted prompt for review. A draft edit alone does not make it stale. Do not silently rewrite the accepted text. The preview-to-submit token is a separate, short-lived guard and cannot substitute for the polish source snapshot. Older prompts without a source snapshot have unknown provenance, rather than an invented current revision.
   The polish request projects only the current scene's confirmed visual fields and selected characters' confirmed identity/look fields, bounded to 4,000 characters total. The visual baseline is text context; it does not select image references.

## Thin slices

1. **Scene → storyboard preview:** project confirmed scene design into the existing visible render preview, while excluding draft fields and keeping media binding unchanged. A newer scene light baseline replaces older plan-light text in this projection; explicit frame lighting still appears. Return the related scene design revision and the plan-light text that was not appended as review metadata, not text for the image model. Add tests for confirmed versus draft design and preview-token invalidation. Do not append to an already accepted complete prompt.
2. **Director → design handoff:** expose the matching plan's place/time/intent as source-tagged suggestions in character and scene editors. Adoption creates a draft, not a confirmed design. Show the source revision and the current asset revision together.
3. **Character → shot handoff:** show selected character design revision and any intentional wardrobe-state override in the shot review. The same confirmed identity powers full-body and turnaround tasks.
4. **Shot review:** detect plan/baseline conflicts, show the current scene master and local camera/light changes, then compare preview text and media bindings with the submitted payload.

## Success criteria and verification

- Two shots in one room can select different camera angles while retaining the same confirmed room geometry and light source; a sofa close-up does not redefine the room.
- One outdoor time-of-day baseline can appear across two streets, while tree shade or an eave changes only local exposure/occlusion.
- Confirmed scene or character edits invalidate a pending shot preview; draft edits do not change the reviewed prompt.
- Image/video requests contain exactly the visible prompt and user-selected media IDs. Tests prove payload equivalence; visual review is still needed to judge generated consistency.

Affected paths for slice 1: `src/apps/comic_gen/pipeline.py` and storyboard render-preview tests. Later slices require a separate frontend and API contract review.
