# Editing Workspace Density and Control Hierarchy v1

## Observed

- The editor previously placed material controls, undo/redo, and audio-lane selection on separate rows.
- Material selection cards used a vertical list with large metadata blocks and an unlabeled audio glyph.
- Panel controls used text buttons, consuming horizontal space.

## Contract

- Full-project controls stay in the project header (save, render, delete, versions).
- Timeline controls stay in the timeline toolbar (undo, redo, audio lane, zoom, add lane, playhead and split).
- Material and inspector panels are toggled with compact icon buttons carrying accessible labels and tooltips.
- The editor material picker uses compact horizontal rows: thumbnail/cover, name and duration summary; detailed metadata remains on hover/focus.
- The picker root action is labeled “打开” and shares a row with search; the picker does not repeat a “选择素材” heading.
- Video thumbnails use a poster fallback where available; audio uses a Lucide icon.

## Success criteria

- The picker is readable at the editor's narrow side-panel width without a second vertical metadata column.
- Undo/redo and audio-lane selection are available in the timeline toolbar.
- Panel collapse controls remain keyboard accessible with `aria-label` and `title`.
