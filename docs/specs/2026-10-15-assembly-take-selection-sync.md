# Assembly take selection synchronization

Observed in production: shot 15 selects a new completed task, while saved assembly plan revision 3 references the previous task. The renderer correctly follows the explicit plan reference, so it renders the older take.

Changing a frame's active take must update project and owner-matching series video clips that reference that frame and its previous selected task. Preserve source trims, timeline placement, disabled state, gain and unrelated/custom take references. Increment changed plan revisions so stale clients and renders cannot publish over a changed plan. Pinned frame selections still prevent auto-selection. No implicit latest-task override at render time.

Verify manual selection, auto-selection, unchanged trims, divergent explicit take references and revision increments. Repair the affected production plan through its optimistic-concurrency API, preserving all edits, then render and inspect the selected source. Ship only the focused fix to the existing deployed tree; do not replace it wholesale with main.
