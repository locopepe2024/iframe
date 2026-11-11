# Staged Director understanding

Episode and Series Director analysis jobs generate independently validated steps:

1. Source preparation: reuse the existing direct-source or bounded map/reduce digest.
2. Foundation: setting, emotional/pacing and visual/performance/dialogue/sound direction, prohibitions, real questions and sample intent.
3. Story structure: compact timeline, relationship changes, key events and the typed story map.
4. Scene continuity: source-backed scene candidates, state bridges, canon facts, shared constraints and the execution summary.

Each generation request uses streaming and only the current step's schema. Later steps receive a bounded projection of completed work, not its raw responses. A Director interpretation groups source events into a concise causal map; it does not expand the screenplay or generate shots. Per-step output budgets reject oversized responses rather than truncating accepted facts.

Validated steps are stored in the existing owner/project/fingerprint-scoped SQLite checkpoints. A malformed JSON object, missing required field, invalid reference, interrupted stream or rejected checkpoint write cannot complete a step. Failed jobs and interrupted workers retain completed checkpoints; submitting the same inputs resumes unfinished work within the existing job retention window. Changing the source/revision, extracted entities, model/provider, visual style, skills, presets or protocol version changes cache identity. Input changes during a request prevent further checkpoint writes and final publication. Superseded workers cannot write checkpoints.

Step persistence never overwrites a saved Director draft or confirmed revision. Once all steps pass admission, the existing editable-draft → save → confirm flow remains in control of the user. Series keeps a global understanding and omits the Episode story map from its final handoff. Account/model context is inherited by the background worker as before; no automatic provider or credential fallback is added.

Both Director panels show the current step and saved/total count. Failure messages identify the failed step and explain that retry resumes unfinished work. Owner-scoped audit results retain each completed step's raw response/hash and the failing step's provider diagnostic; ordinary logs contain neither source text nor credentials.

Validation covers interrupted responses and resume, process/store reload, rejected writes, malformed structure, source/model/style/entity changes, API fingerprinting and input changes during work, account context, scope separation, complete-cache revalidation and the explicit draft/confirmation boundary. Provider calls in these tests are mocked; live upstream reliability still needs deployment testing.
