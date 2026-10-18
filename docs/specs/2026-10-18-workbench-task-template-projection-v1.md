# 工作台任务模板与结构化设计投影 V1

Date: 2026-10-18. Status: design contract; the imported catalog is read-only and is not yet a generation workflow.

## Observed

- open-ai-canvas `backend/internal/workbench/seed/catalog.json` defines named image/video tasks with `focus`, `inputOne`, and optional `inputTwo`. Its seed code turns these into tool input slots and task prompts. The catalog does not define iFrame's project asset identity, confirmed design revision, or provider request.
- iFrame currently imports eight media-free task descriptions in `config/workbench_templates/catalog.json`. They are independently searchable. The character workbench has full-body, three-view, and portrait prompts; a draft can contain structured identity/look fields, but choosing a catalog template does not yet apply those fields to a task.
- The imported `first_last_frame` entry currently labels the last frame optional. That catalog flag is unsuitable as a video submission rule: iFrame's first/last mode requires both frames. Likewise, a role or scene **creation** task can start with text, even if the source template names a reference image. Slot requirements must be derived from the selected workflow and model capability, not copied from source labels.

## Decision: template selects a task, never supplies hidden context

`task_template_id + template_revision` selects a visible task contract. `design_revision` supplies the confirmed subject/space/object facts. The current work item supplies shot or variant overrides. Media slots bind stable `{asset_type, asset_id, variant_id}` identities or a reviewed upload. A visible compiler produces the exact prompt and media list for review. No template text or unselected media is appended after review.

| Task | Confirmed structured input | Explicit media slots | Output preview |
| --- | --- | --- | --- |
| Character bible / full body | Face, hair, skin, build, marks; clothing, palette, accessories, weapon; age appearance only if specified or reviewed | Character reference and costume reference are optional for text creation; bound variants are required only when user chooses reference generation | Full-body prompt, selected references, model/aspect, source revision |
| Character turnaround | Same character design revision as the full-body task; view list is task-local, not another identity owner | Selected character variant if reference mode; optional clothing/prop variant | Three-view or four-view layout shown explicitly; per-view identity, clothing, handedness and accessory checks |
| Prop turnaround | Shape, dimensions/proportions, material/color, wear, grip/attachment, scene state | Bound prop reference when deriving from an existing prop; none for text creation | Front/side/back/detail layout, exact state and references |
| Scene master | Spatial layout, landmarks, entrances, material, activity/people, time/weather, lighting direction/range, style, camera/composition baseline | Optional scene/style references; no automatic people removal | Scene image prompt and source baseline revision; crowd and lighting constraints visible |
| Scene coverage | Same scene master revision plus angle-specific camera/composition override | Explicit selected scene master variant; optional angle reference | Wide/reverse/side image prompts with fixed spatial axis, landmark and light direction |
| Shot keyframe | Scene/character/prop revision references plus shot subjects, positions, gaze, hands, held objects, framing, camera and transition state | Chosen scene/character/prop variants; optional first frame from previous shot only by user action | Current shot first-frame prompt and complete reference list |
| First/last video | Shot motion and state transition with source/target frame identity | **Both** first and last frame variants are required for this mode | Video prompt, first/last media bindings and provider mode |
| Camera study | One camera move, framing, axis and light continuity over a selected shot/scene state | Explicit test first frame; optional camera reference | One-move video prompt, references, mode and duration |

The open-ai-canvas four-view task is a useful **task variant**; iFrame's existing three-view output remains three-view until the user explicitly chooses four-view. A generated full-body image may be offered as a turnaround reference candidate, but it is never silently attached.

## Revision and validation boundary

1. Each task application records `template_id`, `template_revision`, subject `design_revision`, task-local overrides, bound media IDs, compiled prompt, model/mode and a fingerprint. Changing any input invalidates the reviewed submission.
2. Model-drafted field values remain proposals until edited/confirmed. User-specified visual requirements must be visible beside the structured projection; if the projection omits or contradicts them, the workbench asks for review before application. Old free-text notes are compatibility data, not a second hidden prompt source.
3. A scene or shot may copy a prior variant's structured snapshot as its starting point. The target owns the resulting revision; later source changes do not mutate it.
4. Text, first-frame, first/last-frame and reference-video modes validate different media slots. A descriptive catalog slot is not proof that a provider supports that mode.

## Thin implementation order

1. Character task selection: map full-body and three-view tasks to the same confirmed design, expose exact projection and bound reference variants. Verify switching tasks cannot change identity fields or attach media.
2. Scene/prop structured revisions: add their task-specific fields and previews before enabling catalog task application.
3. Shot keyframe and video tasks: bind the current shot and selected media, validate mode-specific slots, then compare reviewed preview with submitted request.

Success requires a reviewer to reconstruct the exact submitted prompt and media list from the saved task application without looking up a mutable URL or relying on hidden defaults.
