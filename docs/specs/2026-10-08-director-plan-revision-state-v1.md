# Director shooting-plan revision state

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
