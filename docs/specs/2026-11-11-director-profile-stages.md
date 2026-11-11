# Staged Director understanding

Episode and Series Director analysis jobs generate independently validated steps:

1. Source preparation: reuse the existing direct-source or bounded map/reduce digest.
2. Foundation: setting, emotional/pacing and visual/performance/dialogue/sound direction, prohibitions, real questions and sample intent.
3. Story structure: compact timeline, relationship changes, key events and the typed story map.
4. Scene continuity: source-backed scene candidates, state bridges, canon facts, shared constraints and the execution summary.

Each generation request uses streaming and only the current step's schema. Later steps receive a bounded projection of completed work, not its raw responses. A Director interpretation groups source events into a concise causal map; it does not expand the screenplay or generate shots. Per-step output budgets reject oversized responses rather than truncating accepted facts.

Prompt isolation: staged jobs build their own minimal prompts instead of reusing the full Director presets or entity-extraction Skill. Each request includes the source once, shared evidence rules once, the current step's instructions/schema, and only nonempty context. Digest explanations appear only for digests; series-context explanations appear only when such context exists. Visual style is supplied once, only for foundation/continuity. Confirmed Series Director context is projected through the bounded execution contract. User-selected methods are explicitly assigned to relevant steps, never silently discarded; unknown assignments fail before provider work. Foundation has no empty completed-step handoff. Story and continuity receive only nonempty, bounded completed-step projections. Changing this prompt protocol invalidates old checkpoints.

When selected review methods refer to unresolved_questions outside foundation, their findings use key_events[].review_notes in story or canon_state.uncertainties in continuity, respecting the existing per-step fields. A synthetic 807-character source with empty entities/style produces a 2,450-character foundation system prompt, versus approximately 6,342 before isolation (about 61% smaller). These are offline assembly measurements, not a capture of the previous live request or proof of upstream recovery.

Acceptance: mocked requests retain source, selected methods and relevant user constraints, omit extraction/crowd templates and other steps' tasks, preserve source/digest and Episode/Series boundaries, and continue to validate/save/resume as before. No live paid request is required to verify prompt assembly. Reducing prompts does not establish the cause or resolution of upstream stream errors.

Validated steps are stored in the existing owner/project/fingerprint-scoped SQLite checkpoints. A malformed JSON object, unresolved missing field, invalid reference, interrupted stream or rejected checkpoint write cannot complete a step. Failed jobs and interrupted workers retain completed checkpoints; submitting the same inputs resumes unfinished work within the existing job retention window. Changing the source/revision, extracted entities, model/provider, visual style, skills, presets or protocol version changes cache identity. Input changes during a request prevent further checkpoint writes and final publication. Superseded workers cannot write checkpoints.

Step persistence never overwrites a saved Director draft or confirmed revision. Once all steps pass admission, the existing editable-draft → save → confirm flow remains in control of the user. Series keeps a global understanding and omits the Episode story map from its final handoff. Account/model context is inherited by the background worker as before; no automatic provider or credential fallback is added.

Both Director panels show the current step and saved/total count. Failure messages identify the failed step and explain that retry resumes unfinished work. Owner-scoped audit results retain each completed step's raw response/hash and the failing step's provider diagnostic; ordinary logs contain neither source text nor credentials.

Validation covers interrupted responses and resume, process/store reload, rejected writes, malformed structure, source/model/style/entity changes, API fingerprinting and input changes during work, account context, scope separation, complete-cache revalidation and the explicit draft/confirmation boundary. Provider calls in these tests are mocked; live upstream reliability still needs deployment testing.

## Story-field completion and admission

A nonempty story result containing only known step fields can receive one scoped completion request when required top-level or story-map fields are absent. Existing fields must first pass validation. The request uses the same model/provider and source, with a schema limited to the absent fields; the original values remain read-only. Top-level and nested omissions share this single request and the original 24,000-character combined response budget. Completion cannot overwrite supplied fields, add unrelated fields, or bypass final shape/reference checks. Malformed JSON and provider failures do not trigger this completion path.

One recognized container error is also eligible: an otherwise valid phases array can contain field-name tokens and nested relationship-arc/story-thread objects. Existing objects are projected only for preflight validation. The model must return the same phase, arc and thread objects in the same per-array order, moving only their containers. Narrative text, unknown shapes, ambiguous destinations and changed/dropped objects are rejected. The projection alone is never saved, and no new phases, events or IDs are fabricated by the server.

Checkpoint audit retains initial raw output and completion output separately. Successful normalized steps remain compatible with the existing checkpoint identity; adding this admission path does not invalidate already admitted steps. Failed completions expose server-owned missing field paths, rather than raw model prose.

At shared draft/patch boundaries, a singleton sample-plan object is wrapped as one array item without splitting named sections. Model finish reasons `content_filter` and `sensitive` are classified as refusal, and `length` as incomplete output, before JSON admission. These classifications also apply to writing, outline and shooting operations through the shared adapter. Kimi K3 joins the existing account-scoped screenplay model selection; no implicit model or credential fallback is introduced.
