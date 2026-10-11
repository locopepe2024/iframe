# Director shooting-plan revision state

## Selected Director version (2026-10-11)

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
