# Director Shooting Plan v1

For typed identities across Script, plan nodes, semantic assets, material, and
shot-scoped keyframes, see `2026-10-10-script-plan-asset-material-identity-v1.md`.
In particular, plan `scene_id` is not `scene_asset_id`, and `person_id` is not
automatically a Character asset ID.

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
4. A scene records a screenplay-facing scene reference, location/time labels, its environment and atmosphere, prop references, and source chunk references. A beat records dramatic purpose, emotional change, optional stable story-map event IDs, and shots. A shot records visual intent, an optional user-editable `director_effect` annotation, character performance, observable physical action, structured lighting (key source/direction, color tone, contrast, practical sources), composition, shot size, camera angle/movement, duration, dialogue, ambient sound, and explicit cast/scene/prop bindings. `director_effect` states the intended audience or editorial effect for this shot; it is a direction note, not a new screenplay fact. These are reviewable visual proposals, not claims about facts absent from the script.
4b. Shot flow is the execution-binding layer between Director planning, Assets and Storyboard. It references canonical entities and revisions; it does not copy their full prompts or create a second asset store. A shot may bind `person_id`, an optional `era_variant_id` (the character's timeline/life-stage variant), an optional `scene_look_id` (the episode or scene wardrobe/look), `scene_asset_id`, and `prop_id` values. The binding also carries scene-specific continuity state such as outerwear on/off, carried props, wetness, hairstyle, makeup, position and facing. `person_id` answers who the character is; `era_variant_id` answers which timeline stage they are in; look and continuity fields answer how they appear in this scene and shot. A time-stage or scene look must never create a replacement person identity.
4a. Confirmed regional or setting decisions (for example, “the school is in Xi'an”) are downstream visual constraints. If the script does not name a landmark, local food or street detail, the plan may propose an optional visual anchor in `location`, `environment_atmosphere`, `visual_intent`, or `director_effect`. The proposal must be labeled as an optional Director addition and may also be surfaced in `unresolved_questions`; it must not be recorded as an established screenplay event or force a new action, dialogue, or scene. The user decides whether to keep, edit, or remove it.
5. Shot count is derived from `scenes[].beats[].shots[]`; it is never inferred from action/event count, and no separate count field is accepted. Total runtime is derived from shot durations. Do not copy old storyboard frames or convert `sample_plan` items into shots.
6. Long scripts use the existing bounded natural-boundary source chunker and resumable extraction-job batch storage. Every returned scene records the source chunk(s) that informed it; chunk bounds must not be presented as exact semantic scene boundaries.
7. The generation prompt may propose cuts and durations, but user edits and confirmation are the production decision. A beat may contain multiple shots, and a shot may cover several continuous actions when screen direction and dramatic intent allow it.
8. Confirmation only activates the plan revision. Assets and Storyboard do not consume it in this slice; connecting confirmed shot plans to those stages requires a separate adapter, migration/lineage contract, and behavior tests.

## Contract and validation

- `DirectorShootingPlan`: schema version, source revision and stable source ID, confirmed Director revision/hash, effective-style hash, ordered scenes, and generated-at metadata.
- Scene: stable ID/order, scene reference, optional heading/location/time, environment/atmosphere, prop IDs, source chunk refs, and beats. Scene-level asset candidates may be attached, but selected shot bindings remain authoritative for execution.
- Beat: stable ID/order, title, dramatic purpose, emotional change, optional story-map event references, and shots.
- Shot: stable ID/order, visual intent, optional `director_effect` (maximum 2400 characters), character performance, physical action, structured lighting, shot size, camera angle, composition, camera movement, duration in seconds, dialogue lines, ambient sound, and reference-only cast/scene/prop bindings. Cast bindings use `person_id`, optional `era_variant_id`, optional `scene_look_id`, and a continuity-state object; scene bindings use `scene_asset_id` plus interior/exterior, time-of-day and season context when known; prop bindings use `prop_id` plus presence/state. These bindings are IDs and small state snapshots, not duplicated asset descriptions.
- Strict Pydantic models reject unknown keys, duplicate IDs/order values, unresolved story-map event IDs, or unavailable character/prop references. Drafts and confirmed plans may retain incomplete creative details. The system may suggest missing environment, performance, lighting, sound, camera or duration fields, but suggestions never block generation, saving, or confirmation; the user decides whether to accept, edit, or leave them blank. Structural integrity, valid references and recoverable task state remain technical checks. `director_effect` is optional so existing plans remain confirmable; when present it is persisted with the shot and included in the confirmed plan revision. Durations are bounded and totals are derived.
- Source chunk references identify model input provenance only. They are not exact source ranges or proof that the model's interpretation is correct.
- Normal Script responses omit plan drafts and histories. Dedicated endpoints own plan reads, draft save, confirmation, history, and generation jobs.

## User workflow

1. Confirm a Director profile that has an explicitly reviewed story map.
2. Generate a shooting-plan draft from the bound script, story map, available character variants, and style.
3. Review and edit scene grouping, beat purposes, shot count, durations, image composition, actions, the intended `director_effect` for individual shots, dialogue and sound.
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

## Continuation slice: scene continuity and beat timing (2026-09-26)

The shooting-plan editor now carries explicit continuity metadata without changing
confirmation semantics:

- Scene fields: `continues_previous_scene`, `continuity_in`, `continuity_out`, and optional `duration_seconds`.
- Beat fields: optional `duration_seconds`, `keep_with_next`, and generated `source_chunk_refs`.
- LLM output may propose continuity and durations; the server validates and binds source chunk refs.
- Chunk stitching preserves continuity metadata when the first scene of a later chunk continues the previous scene.
- These fields describe planning continuity only. They do not create Storyboard frames or Motion tasks.

## Continuation slice: shot director-effect annotation (2026-09-26)

`director_effect` is a shot-level review field. It is generated as an optional proposal,
can be edited in the shooting-plan draft, survives draft save/restore, and is copied into
the confirmed shooting-plan revision. Confirming a shooting plan still activates only that
plan revision; the annotation is not implicitly applied to Storyboard or Motion. A future
Storyboard handoff must carry it through an explicit adapter and its own apply/confirm action.

## Continuation slice: shot flow map (2026-09-26)

The shooting-plan review surface includes a readable scene → beat → shot flow map with
visible connector lines. Shot cards expose the title, duration, and director effect at a
glance; selecting a card opens the corresponding editable shot details. The map is a view
of the same nested plan data and does not create a second ordering or confirmation state.

## Continuation slice: director graph editor (2026-09-26)

The primary review surface is a three-lane graph rather than nested drawers:

- Scene, Beat, and Shot are separate visual lanes.
- Scene → Beat edges express ownership; Beat → Shot edges express membership; Shot → Shot edges express ordered cutting within a beat.
- Selecting a Shot keeps the graph visible and opens a persistent inspector beside it. The inspector edits the selected shot in the same draft; it is not a second state or a modal drawer.
- The graph may use a layout-only position in the frontend, but canonical order remains `scenes[].beats[].shots[]`. Moving or reordering a node must update that canonical order before save.
- Nodes expose the information needed for scanning: title, duration, shot size, and director effect. Long text is edited in the inspector rather than truncated into the graph.
- Scene continuity and unresolved questions remain attached to their source Scene/Beat nodes; they are not inferred from graph geometry.

The first implementation may use a lightweight DOM graph with semantic connectors. A graph library
such as XYFlow can be introduced only if pan/zoom, edge editing, or large-plan performance requires
it; adopting a library is not itself a change to the Director data contract.

## Continuation slice: cast, scene and prop bindings (2026-10-03)

Shot flow is the execution-binding layer between Director planning, Assets and Storyboard. It does not
copy full prompts or create a second asset store. Character references use four distinct layers:

```text
person_id（全剧永久身份）
  → era_variant_id（时间线/人生阶段）
  → scene_look_id（本集或本场造型）
  → continuity_state（镜头连续性状态）
```

`person_id` answers who the character is; `era_variant_id` answers which timeline stage they are in;
`scene_look_id` answers how they are dressed and presented in this episode or scene; continuity state
answers how coat, props, wetness, hairstyle, makeup, position and facing carry between shots. A five-to-
ten-year production keeps one `person_id` and may use multiple era variants. An episode covering a few
days can select outdoor, indoor, dormitory or party looks under the same era variant. A look change must
never create a replacement character identity.

Minimum shot binding:

```json
{
  "cast": [{
    "person_id": "shenxia",
    "era_variant_id": "shenxia-university",
    "scene_look_id": "shenxia-winter-outdoor",
    "continuity_state": {"outerwear": "on", "carried_props": []}
  }],
  "scene": {
    "scene_asset_id": "campus-winter-exterior",
    "interior_exterior": "exterior",
    "time_of_day": "day",
    "season": "winter"
  },
  "props": [{"prop_id": "zhouhan-luggage", "state": "present"}]
}
```

Bindings may be `unresolved`, `suggested`, `selected` or `confirmed`. Missing generated images do not
block plan drafting. Storyboard/video generation may require confirmed bindings for the assets actually
used by a requested shot. User acceptance, editing and deletion remain explicit decisions.

## Revision catalog and retrieval boundary

A shooting-plan revision has a lightweight searchable catalog entry: user title, summary, revision, created time, source script revision, source Director revision, structural counts, and content hash. The latest revision is the default. Users may select historical revisions by title, summary, revision, time, or source lineage. Restoring a historical revision creates a new draft revision and never overwrites the original snapshot. This is a structured version index, not an embedding or RAG system.
