# Editing workspace layout

Problem: the duplicate vertical sequence list separates the video preview from the real timeline. Selecting a cut requires scrolling between disconnected controls.

Decisions:
- One sequence surface: filmstrip clips in timeline order, with stable per-segment accessible names. Remove the separate sequence list.
- On desktop, preview and timeline sit side by side. The timeline has its own bounded vertical scroll. On narrow screens, use a compact preview above the bounded timeline.
- Timeline toolbar contains exact playhead, split, zoom and fit. Clip selection exposes trim, earlier/later and delete in the same timeline pane.
- Move the material library below the editor so an existing project opens at its editing controls. Caption settings use progressive disclosure.
- Keep the plan schema, media ownership, saved source ranges, undo/redo and rendering unchanged.

Verification: reorder 2,1,3 through filmstrip selection, trim/split/recombine, millisecond split, zoom/fit, desktop and narrow-screen bounding boxes showing preview and ruler simultaneously, source frame decoding, save/reopen. Do not modify the user's project during browser acceptance.
