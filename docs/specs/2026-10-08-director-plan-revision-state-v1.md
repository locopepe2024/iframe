# Director shooting-plan revision state

## Selected Director version (2026-10-11)

## AI generated lighting inheritance (2026-10-11)

The model proposes a lighting description for each shot. The runtime derives
one baseline from the first shot for each reviewed place/time pair. For shots
sharing that pair, the generated per-shot lighting is treated as inherited
unless the model explicitly supplies a reason for a deliberate lighting
change. Inherited shots store empty lighting fields and use the baseline in
the episode visual context. A justified exception keeps its shot lighting and
reason. The model is asked to return an exception reason only for a real
change; the runtime never invents a reason from differing prose.

Existing saved drafts are not rewritten. The editor presents those conflicts
as review items with both values. Generation should yield a confirmable
baseline by default, so the user reviews exceptions instead of filling every
shot field. Editing the scene baseline or an individual shot remains possible.

## Review-first shooting-plan interaction (2026-10-11)

The shooting plan is an AI generated execution proposal, not a form that asks
the director to author every downstream prompt. The normal review is one
continuous scene → beat → shot reading order. Do not require users to switch
between a graph, timeline, inspector, and a separate editor to understand one
plan, and do not repeat the same scene/beat/shot counts in several overview
widgets.

Keep the review surface focused:

1. **Scene continuity**: scene name, place/time, incoming/outgoing continuity,
   and atmosphere are visible in the main list.
2. **Story and shot intent**: beat purpose/emotional change and each shot's
   intent, intended effect, visible action, framing, and duration are visible
   in the same reading order.
3. **Edit on demand**: editing controls are collapsed beside the item they
   affect. Advanced IDs, asset bindings, sources, dialogue/audio details, and
   lighting exceptions are secondary controls; ordinary users review AI's
   proposal and do not fill each field manually.

The AI is responsible for proposing the plan and its bindings. A user normally
reviews the story and shot intent, then opens a detail only to fix an error or
approve a deliberate exception. Never present raw internal IDs as a normal
manual task. A lighting conflict deep-links to the relevant scene and shot and
shows the baseline and shot values side by side at the point of decision.

The confirmed plan is projected into `episode_visual_context`. Storyboard
generation and storyboard refinement receive only the context whose
`scene_ref` matches the requested source text (with a single-scene fallback).
The handoff includes that scene's shots, character states, props, scene asset,
and inherited lighting. It is an input constraint for the storyboard model;
the runtime must still validate scene/asset/lineage references, and prompt
presence alone does not prove that a model followed the context.

## Storyboard prompt routing (2026-10-11)

The plan is not copied wholesale into a list of manually maintained prompt
fields. Its visual direction is routed by meaning:

- scene entry/exit continuity, atmosphere, acting, physical action,
  composition, and lighting are given to storyboard refinement as one
  scene-scoped director context;
- shot size, camera angle, and duration use the storyboard's existing
  structured fields. Camera movement uses its existing structured field when
  available; otherwise the confirmed plan wording is appended as a plain
  constraint, without inventing a `static` camera setting;
- confirmed character/prop IDs continue through the existing asset reference
  path;
- dialogue remains structured dialogue, while ambient sound remains audio
  direction.

When a storyboard frame is bound to one confirmed plan shot, it stores a
server-projected read-only snapshot of that shot context. The R2V prompt
assembler adds only the visual constraints not already present in the frame's
visual description. The final prompt preview must show this assembled result.
The frame may still be split from a plan shot, but context must never be
borrowed from a different scene or shot. Frames without an unambiguous match
keep no shot context rather than silently guessing.

The Director interpretation and shooting plan share one selected Director
revision in the Direction workspace. The selection defaults to the latest
confirmed revision and is reset when the project or confirmed revision changes.
Choosing an older revision is a read-only history view; it does not activate,
restore, save, or confirm that revision. The Director's separate "copy version
to draft" action remains an explicit editing operation.

The plan view matches confirmed plans by Director revision **and content hash**.
When several confirmed plans match, display the newest by default and allow
selection among their own plan revisions. A historical Director selection with
no matching plan shows an empty history state. It cannot generate or confirm a
plan because generation uses the current confirmed Director revision.

For the latest Director revision, show the editable saved plan draft only when
its Director revision and hash match the selection and its script lineage is
current. Otherwise show the matching confirmed plan as read-only reference and
provide generation of a new proposal from the selected current Director. A
draft from another Director version remains stored but must not appear as the
current version's editable plan. Generation may replace that saved draft only
after the user saves the new proposal; confirmed plan history is retained.

Always label a plan with both numbers: plan revision and source Director
revision. Plan revision numbers are independent and never imply equal Director
revision numbers. Downstream production continues to use the current confirmed
plan; merely browsing history does not change downstream inputs.

Success criteria: switching Director versions switches the plan history shown;
v6 cannot display a v4-sourced draft as its editable plan; selecting v4 shows
only plans sourced from the exact v4 content hash; switching versions never
mutates confirmed history or a local unsaved plan.

Updated 2026-10-11: Director changes require a new plan proposal. The earlier
Director-only alignment action below is superseded by this contract.

## Observed

- Director interpretation revision and shooting-plan revision are separate counters.
- The reported episode has Director interpretation v2, shooting-plan confirmed v2,
  and saved draft r2. Both shooting-plan snapshots still reference Director v1.
- Confirming an unchanged stale plan can return the existing confirmed revision,
  leaving the stale warning visible.

## Contract

- Show the source Director revision for the displayed draft and confirmed plan.
- A saved draft revision does not imply adoption of the latest Director revision.
- A new confirmed Director revision makes a plan draft based on an older
  Director revision stale. Keep its original source revision and Director
  revision visible; its draft `r` is only a save counter.
- Generate a new proposal from the current confirmed Director revision before
  confirming a plan for that revision. Generation creates an unsaved local
  proposal; saving it replaces the server draft, not confirmed plan history.
- The old plan remains readable as reference. Saving edits to that old draft
  retains its old lineage and cannot make it confirmable under the new Director.
  Never treat a lineage-only rewrite as a fresh scene/beat/shot design.
- Review the new proposal's scene grouping, event links, continuity, beats and
  shots; then save and confirm it. Older confirmed plan revisions remain history.
- A changed script source also requires a new proposal from the current source
  and Director. Obsolete story event IDs are shown as historical references,
  not as a reason to relabel the old plan.

## Success criteria

1. The reported v2/v2/r2 state names the plan draft counter and both Director
   revisions, and offers generation from the current Director revision.
2. Ordinary saving of an edited old draft preserves its old Director lineage.
3. Generating a new proposal uses the current Director revision; discarding it
   restores the saved old draft. Saving and confirming the new proposal produces
   a new plan revision while preserving older confirmed plan revisions.
4. Existing style-only changes do not stale shooting plans.

## Not yet proven

The UI no longer offers a lineage-only alignment action. The backend still
accepts a client-supplied plan payload carrying current lineage if it passes
validation; it does not independently prove that its scene/beat/shot design was
regenerated. A future server contract should pin proposal provenance to a
generation job or a reviewed manual adaptation decision before accepting a
changed Director lineage.

Affected paths: `frontend/src/components/modules/DirectorShootingPlanPanel.tsx`,
`frontend/messages/{zh,en}.json`, and focused panel tests.
