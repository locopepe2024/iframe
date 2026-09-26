# Director Plan to Storyboard Handoff v1

## Goal

Allow a user to explicitly apply a confirmed Director shooting plan to the Storyboard stage as one frame per planned shot. Preserve the reviewed visual decisions and trace each Storyboard frame back to its confirmed plan revision, scene, beat, and shot.

## Current behavior (code facts)

- Director shooting plans are versioned independently and confirmation does not modify Storyboard frames.
- Storyboard analysis has a separate preview/refine/apply flow. Applying replaces the project's frame list.
- `StoryboardFrame` already stores visual atmosphere, character acting, action physics, structured lighting, shot size, camera movement, composition, duration, dialogue, and audio notes.
- Plan shots already reference stable character and prop IDs, but plan scenes do not yet bind to a stable Scene asset ID.

## Decisions

1. Applying is a separate, user-triggered action on an up-to-date confirmed shooting-plan revision. Drafts and stale confirmed plans cannot be applied.
2. Applying maps the confirmed plan directly to frames; it does not call an LLM, create video tasks, or generate media.
3. One plan shot becomes one Storyboard frame. The adapter copies visual atoms and stable asset references; it does not reinterpret or split shots.
4. Every plan scene must bind to an available Scene asset before applying. The UI provides a stable-ID selector; the backend rejects missing or unavailable bindings rather than falling back to the first scene.
5. The API uses optimistic preconditions for the confirmed plan revision/hash and the exact current frame ID list. This prevents applying an outdated plan or silently replacing frames changed since the user opened the confirmation.
6. The confirmation UI states how many current frames will be replaced and how many planned shots will be applied. The user must explicitly confirm.
7. New Storyboard frames store the plan revision/hash and plan scene/beat/shot IDs in addition to normal script/Director lineage.
8. Applying replaces the Storyboard frame collection using the existing explicit replacement semantics. It does not create, cancel, or delete Motion tasks; the UI states that separately.
9. Source range, plan duration, lighting, performance, action physics, composition, camera direction, dialogue, and ambient sound map to their corresponding `StoryboardFrame` fields. Multi-line dialogue is preserved as text; the singular structured dialogue field is set only when the shot has exactly one dialogue line.

## Validation

- Plan revision exists, is current, matches the submitted hash, and matches current script, confirmed Director, and style lineage.
- Expected current Storyboard frame IDs exactly match persisted frame IDs.
- Every scene asset ID, character ID, and prop ID exists in the effective episode asset set.
- Plan shots remain complete under the existing confirmation contract.
- Apply tests assert one frame per shot, complete visual-field mapping, provenance IDs, no LLM call, and no video-task mutation.

## Scope

### Included

- Optional scene asset binding in the plan schema, LLM contract, plan editor, and plan validation.
- Explicit apply endpoint and a confirmation dialog on the Director shooting-plan tab.
- Deterministic plan-to-frame adapter with lineage and stable plan source IDs.
- Backend/API/UI behavior tests and en/zh copy.

### Excluded

- Assets generation or modification, video/Motion tasks, partial frame merge, automatic shot splitting, storyboard refinement after application, RAG, and deployment.

## Success criteria

- User can bind each planned scene to an existing Scene asset, save and confirm the plan, then explicitly apply it.
- Stale plan or changed Storyboard frames produce a conflict with no mutation.
- Applying replaces frames only after explicit user confirmation and produces exactly one frame per shot with traceable source IDs.
- No LLM or video-generation task is called during apply.
- Targeted backend/UI tests, typecheck, full test suites, production build, i18n validation, and `git diff --check` pass.

## Affected paths

- `src/apps/comic_gen/models.py`, `pipeline.py`, `api.py`, `llm.py`
- `tests/test_director_shooting_plan.py`
- `frontend/src/lib/directorShootingPlan.ts`, `frontend/src/lib/api.ts`
- `frontend/src/components/modules/DirectorShootingPlanPanel.tsx` and tests
- `frontend/messages/en.json`, `frontend/messages/zh.json`

## Boundary

Local implementation and commits only. No push or deployment.
