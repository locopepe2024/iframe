# Assembly take selection synchronization

Observed in production: shot 15 selects a new completed task, while saved assembly plan revision 3 references the previous task. The renderer correctly follows the explicit plan reference, so it renders the older take.

Changing a frame's active take must update project and owner-matching series video clips that reference that frame and its previous selected task. Preserve source trims, timeline placement, disabled state, gain and unrelated/custom take references. Increment changed plan revisions so stale clients and renders cannot publish over a changed plan. Pinned frame selections still prevent auto-selection. No implicit latest-task override at render time.

Verify manual selection, auto-selection, unchanged trims, divergent explicit take references and revision increments. Repair the affected production plan through its optimistic-concurrency API, preserving all edits, then render and inspect the selected source. Ship only the focused fix to the existing deployed tree; do not replace it wholesale with main.

## Existing-plan refresh
- Observed online: shot 9 was pinned to a replacement before the selection-sync deployment, while its saved clip still referenced an earlier task. Selection events cannot repair already-stale references.
- Add an explicit Refresh shot variants action. Fetch the project, replace frame-backed video clip task IDs with current selected completed task IDs, preserve all timing/mix/enable fields, and leave the refreshed plan as an editable draft for Save. Respect revision conflicts when edits are pending.
- Before project assembly rendering, fetch the saved plan and current selections, reconcile and save changed task references with the existing optimistic revision check, then render. Do not pick the newest task over a user's pinned selection.
- Scope: project Assembly UI; series timeline and rendering remain unchanged. Validate helper behavior for pinned replacements, edits, unavailable selections, non-video lanes and cross-project references; run typecheck and assembly UI tests.
