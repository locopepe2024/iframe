# Script opening memory and history v1

## Observed

- Entity, storyboard, and director analysis already run as durable owner-scoped
  jobs, and an explicit apply is required before the project is mutated.
- The current script editor shell creates an editor but does not connect the
  auto-save hook or the snapshot dialog.
- Document snapshot metadata returned by the API does not match the frontend
  contract, and restoring a snapshot overwrites the current document without
  first preserving it.

## Direct implication

The first story-opening pass can be analyzed and refined, but the editor cannot
reliably carry that work across a reload or recover the version that existed
before a restore. A version history operation must be reversible and its
metadata must be consumable by the UI.

## Scope

- Keep AI analysis jobs owner-scoped and draft-only until explicit apply.
- Make the script editor load and save its persisted Tiptap document.
- Expose manual save, snapshot history, and restore from the editor toolbar.
- Create a restore-point snapshot before replacing the current document.
- Return stable snapshot timestamps and sizes using the frontend contract.
- Do not change UniFlow, dev-suz, or provider/model routing.

## Success criteria

1. A story-opening document survives an editor remount.
2. Cmd/Ctrl+S creates a listed snapshot.
3. Restoring a snapshot returns the selected content and leaves a restore-point
   snapshot for the document that was replaced.
4. The restored document remains editable and can be saved again.
5. Existing entity, storyboard, and director job tests remain green.

## Evidence limit

These checks prove transport, persistence, and mutation boundaries. They do not
prove that a selected model follows every narrative instruction; that remains a
model evaluation task.
