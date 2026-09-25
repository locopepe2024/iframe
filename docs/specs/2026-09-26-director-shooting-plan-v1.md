# Director Shooting Plan v1

## Goal

Add a reviewable Director shooting-plan resource that converts the current script and a confirmed Director story map into a scene → beat → shot proposal. The user can generate, edit, save, restore and explicitly confirm the plan. A confirmed plan is a planning artifact; it does not create storyboard frames or Motion tasks.

## Evidence-backed current state

- `Script` embeds the current Director draft and keeps confirmed Director profile snapshots in an append-only revision list. Dedicated APIs load and save drafts with expected-revision checks; Apply confirms a saved draft.
- Director `story_map` now provides stable phase/event IDs, relationship state IDs, story threads, and references to the confirmed Script Fact Ledger.
- `StoryboardFrame` is a downstream artifact with different responsibilities and fields: it carries visual atoms, dialogue, camera data, lighting and duration. The current storyboard analysis still generates frames directly from script text.
- The Director shooting-plan tab currently displays `sample_plan` examples and an empty state. Those examples are not canonical scenes, beats, shots, or tasks.
- The Script response omits large draft/history resources from ordinary project payloads. A shooting plan must follow that boundary so project reads do not grow with plan history.

## Architectural decisions

1. Store the plan separately from `DirectorProfile`, with its own current draft, draft revision, confirmed revision, immutable confirmed snapshots and content hash. The plan may cite a Director profile, but changing the plan does not rewrite story understanding.
2. Bind every generated/saved/confirmed plan to the current script source revision, confirmed Director profile revision/hash, and effective visual-style hash. Refuse confirmation if any bound input changed.
3. Use one canonical hierarchy: ordered scenes contain ordered dramatic beats, and beats contain ordered shots. Timeline cards and future visual maps are views of this same structure.
4. A scene records a screenplay-facing scene reference, location/time labels, its environment and atmosphere, prop references, and source chunk references. A beat records dramatic purpose, emotional change, optional stable story-map event IDs, and shots. A shot records visual intent, character performance, observable physical action, structured lighting (key source/direction, color tone, contrast, practical sources), composition, shot size, camera angle/movement, duration, dialogue, ambient sound, and optional character-variant/prop IDs. These are reviewable visual proposals, not claims about facts absent from the script.
5. Shot count is derived from `scenes[].beats[].shots[]`; it is never inferred from action/event count, and no separate count field is accepted. Total runtime is derived from shot durations. Do not copy old storyboard frames or convert `sample_plan` items into shots.
6. Long scripts use the existing bounded natural-boundary source chunker and resumable extraction-job batch storage. Every returned scene records the source chunk(s) that informed it; chunk bounds must not be presented as exact semantic scene boundaries.
7. The generation prompt may propose cuts and durations, but user edits and confirmation are the production decision. A beat may contain multiple shots, and a shot may cover several continuous actions when screen direction and dramatic intent allow it.
8. Confirmation only activates the plan revision. Assets and Storyboard do not consume it in this slice; connecting confirmed shot plans to those stages requires a separate adapter, migration/lineage contract, and behavior tests.

## Contract and validation

- `DirectorShootingPlan`: schema version, source revision and stable source ID, confirmed Director revision/hash, effective-style hash, ordered scenes, and generated-at metadata.
- Scene: stable ID/order, scene reference, optional heading/location/time, environment/atmosphere, prop IDs, source chunk refs, and beats.
- Beat: stable ID/order, title, dramatic purpose, emotional change, optional story-map event references, and shots.
- Shot: stable ID/order, visual intent, character performance, physical action, structured lighting, shot size, camera angle, composition, camera movement, duration in seconds, dialogue lines, ambient sound, character variant IDs, and prop IDs.
- Strict Pydantic models reject unknown keys, duplicate IDs/order values, unresolved story-map event IDs, or unavailable character/prop references. Drafts may be incomplete; confirmation requires at least one named scene with environment/atmosphere, one described beat, and one shot with visual intent, performance, physical action, lighting source/color/contrast, shot size, camera angle, composition, camera movement, ambient sound, and duration in each beat. Durations are bounded and totals are derived.
- Source chunk references identify model input provenance only. They are not exact source ranges or proof that the model's interpretation is correct.
- Normal Script responses omit plan drafts and histories. Dedicated endpoints own plan reads, draft save, confirmation, history, and generation jobs.

## User workflow

1. Confirm a Director profile that has an explicitly reviewed story map.
2. Generate a shooting-plan draft from the bound script, story map, available character variants, and style.
3. Review and edit scene grouping, beat purposes, shot count, durations, image composition, actions, dialogue and sound.
4. Save the draft; confirm only after required fields are complete and lineage still matches.
5. Assets/Storyboard integration is deferred to a follow-up slice.

## Scope

### Included

- Pydantic schema, Script persistence fields, public-response exclusion, lineage binding, validation, draft save/load, confirm/history endpoints, and a resumable generation job.
- Director shooting-plan frontend with generation, structured editing, draft save, explicit confirm, confirmed history display, stale-input status, total-shot/runtime summaries, and responsive/keyboard controls.
- Tests for schema/reference validation, stale lineage, draft concurrency, confirm requirements, generated batch behavior, API boundaries, and UI workflow.

### Excluded

- Replacing `StoryboardFrame`, applying the plan to existing frames, Assets consumption, Motion tasks, RAG, automatic migration from `sample_plan`, exact scene-range inference, drag-only editing, or deployment/publishing.

## Success criteria

- A plan is separately versioned from Director story understanding and can be resumed as a draft after reload.
- Shot count and total duration are derived from nested shot data.
- Confirmation rejects incomplete plans or changed script/Director/style inputs.
- Ordinary project responses do not contain plan drafts or full revision history.
- Model output is a proposal only; no generation or Apply silently changes existing frames/tasks.
- Frontend typecheck, UI tests, production build, targeted backend tests, and `git diff --check` pass.

## Affected paths

- `src/apps/comic_gen/models.py`, `pipeline.py`, `api.py`, `llm.py`
- `frontend/src/store/projectStore.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/directorProfile.ts`
- `frontend/src/components/modules/DirectorShootingPlanPanel.tsx` and tests
- `frontend/messages/en.json`, `frontend/messages/zh.json`
- Director API/model/UI tests and this specification

## Implementation boundary

Ship this as local commits only. Do not push or deploy. Keep story understanding, shooting plan, style selection, Assets, Storyboard and Motion as separate user decisions and revision/lineage boundaries.
