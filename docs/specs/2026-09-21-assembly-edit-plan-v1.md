# Assembly swimlane edit plan v1

## Status

Implementation specification for a bounded, owner-scoped Assembly timeline
that can be proposed by an editorial Agent and adjusted by a human before
rendering.

## Observed

- **Code fact:** `VideoAssembly` currently groups completed Motion outputs by
  `frame_id`, lets the user select a take, applies project-level BGM and mix
  levels, then calls `merge_videos`.
- **Code fact:** `merge_videos` concatenates selected videos in persisted
  `Script.frames` order. It has no persisted clip positions, arbitrary trims,
  cross-episode source IDs, or separate media lanes.
- **Code fact:** `StoryboardFrame` already carries video, dialogue, SFX and
  duration metadata; `Script` already carries BGM and mix settings.
- **Direct implication:** Assembly is the correct boundary for a series sample
  cut. Motion generation stays per-shot and paid-provider recovery semantics
  stay unchanged.
- **Runtime observation:** the supplied public reference is a FunClip Gradio
  app. Its public configuration exposes an LLM inference endpoint that returns
  timestamped text ranges, followed by an AI-clip action that materializes
  those ranges into video clips. It also exposes start/end offsets and subtitle
  outputs.
- **Source-backed candidate:** `modelscope/FunClip` is an MIT-licensed,
  local Gradio transcription/LLM-clipping tool. The supplied
  `locopepe2024/FunASR` repository is a public fork of `modelscope/FunASR`,
  also MIT-licensed at the toolkit level, and documents OpenAI-compatible and
  MCP serving with timestamped ASR/VAD/speaker results.

## Goal

Add a versioned `AssemblyEditPlan` that represents a project- or series-scoped
swimlane timeline. Content IR or an Agent may propose the plan, but the owner
must be able to inspect and edit it before render. The first slice persists and
validates the plan; rendering continues through the existing deterministic
FFmpeg path until the timeline compiler is introduced.

## Contract

1. `AssemblyEditPlan.scope` is `project` or `series`.
2. A plan has a bounded target duration, revision, source/director/content
   provenance fields, ordered lanes, and markers.
3. A clip stores stable project/episode/frame/task IDs and timeline/source
   ranges. It must not persist a short-lived signed URL as its identity.
4. Lane kinds are `video`, `dialogue`, `bgm`, `sfx`, and `markers`. Only video
   and audio clips render; markers carry editorial evidence and do not render.
5. A series plan may reference only episodes registered in that series and
   their owned frames/tasks. A project plan may reference only the project.
6. `source_refs` are required for editorial video clips. They point back to
   Director/Content IR evidence and are not generated facts.
7. Within a video lane, clips may not overlap. Audio lanes may overlap only
   when the lane explicitly allows it. Timeline positions and durations are
   integer milliseconds.
8. The default sample target is 60,000 ms. A three-segment sample may use
   `[20,000, 20,000, 20,000]`, but the plan remains editable rather than
   hard-coding three formal episodes.
9. Plan updates are optimistic-concurrency checked by plan revision. A stale
   update returns `409`; saving an edit increments the plan revision.
10. Agent proposals are untrusted drafts. No plan update submits a paid Motion
    task. Rendering requires an explicit Assembly action after validation.
11. FunClip/FunASR are optional evidence/timestamp adapters, not the canonical
    timeline or narrative authority. They may supply audio segments,
    subtitles, speaker labels, and offsets. Director/Content IR source refs
    remain the authority for story coverage. Pretrained model weights retain
    their own licenses.

## Boundaries

- This slice does not replace `merge_videos` or change provider routing.
- This slice does not add an autonomous Agent runtime. It exposes a stable
  plan shape that an existing constrained planner can target later.
- This slice does not embed the FunClip Gradio UI or expose FunASR's example
  server publicly. FunClip's LLM clipper pattern may be adapted behind the
  owner-scoped Assembly API; FunASR MCP/OpenAI endpoints require a private
  gateway, authentication, upload limits, and explicit timestamp validation.
- This slice does not infer missing story beats. Missing `source_refs` or
  unavailable media are validation errors/warnings, not fallback content.
- Legacy projects with no plan continue to use the existing frame-order merge
  path.
- The first UI surface remains operational and dense: timeline lanes, markers,
  duration, source labels, and explicit save/validate actions; no decorative
  editor chrome is added.

## Success criteria

1. Project and series plans round-trip through owner-scoped GET/PUT APIs.
2. Invalid episode/frame/task references, overlaps, ranges, and stale revisions
   fail with clear errors.
3. Existing projects without a plan retain current Assembly behavior.
4. The frontend can display the plan as lanes and save a basic ordering/edit
   without losing the existing Takes/Mix/Export phases.
5. Tests cover model bounds, ownership/reference validation, revision conflicts,
   and the 60-second three-segment plan.

## Affected paths

- `src/apps/comic_gen/models.py`
- `src/apps/comic_gen/pipeline.py`
- `src/apps/comic_gen/api.py`
- `tests/test_assembly_edit_plan.py`
- `frontend/src/store/projectStore.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/components/modules/VideoAssembly.tsx`
- `frontend/src/components/modules/assemblyEditPlan.ts`
- focused frontend Assembly tests

## Verification

```bash
pytest -q tests/test_assembly_edit_plan.py
cd frontend && npm run typecheck
cd frontend && npm run test:ui -- src/components/modules/VideoAssembly.test.tsx
git diff --check
```
