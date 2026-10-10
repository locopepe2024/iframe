# Director shooting-plan revision state

## Observed

- Director interpretation revision and shooting-plan revision are separate counters.
- The reported episode has Director interpretation v2, shooting-plan confirmed v2,
  and saved draft r2. Both shooting-plan snapshots still reference Director v1.
- Confirming an unchanged stale plan can return the existing confirmed revision,
  leaving the stale warning visible.

## Contract

- Show the source Director revision for the displayed draft and confirmed plan.
- A saved draft revision does not imply adoption of the latest Director revision.
- When the script source is unchanged and the current Director interpretation is
  ready, explicitly align the displayed draft to the current Director revision
  before saving. Validate the aligned plan against current story events.
- If current story events no longer resolve, keep the old draft and show the
  validation error so the user can revise its references.
- Confirm only a saved draft aligned with current stable lineage. Confirmation
  creates a new shooting-plan revision; older confirmed revisions remain history.
- A changed script source requires a new or revised plan; do not relabel its
  source revision through the Director-only alignment action.

## Success criteria

1. The reported v2/v2/r2 state names both revision domains and offers alignment.
2. Saving an edited draft under the same script source pins current Director v2.
3. After saving, only the old confirmed revision is marked stale; confirming
   the aligned draft removes the warning.
4. Existing style-only changes do not stale shooting plans.

Affected paths: `frontend/src/components/modules/DirectorShootingPlanPanel.tsx`,
`frontend/messages/{zh,en}.json`, and focused panel tests.
